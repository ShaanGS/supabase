import { getNodesBounds, MiniMap, Panel, useStore, type Rect } from '@xyflow/react'
import { useId, useMemo } from 'react'

const MINIMAP_MAX_WIDTH = 200
const MINIMAP_MAX_HEIGHT = 150
const VIEWPORT_RADIUS = 8
const LENS_BAND = 16
const LENS_SCALE = 24

const getLensMap = ({
  width,
  height,
  lens,
  radius,
}: {
  width: number
  height: number
  lens: Rect
  radius: number
}): string => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return ''

  const image = context.createImageData(width, height)
  const centerX = lens.x + lens.width / 2
  const centerY = lens.y + lens.height / 2
  const innerX = lens.width / 2 - radius
  const innerY = lens.height / 2 - radius
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const offsetX = px + 0.5 - centerX
      const offsetY = py + 0.5 - centerY
      const qx = Math.abs(offsetX) - innerX
      const qy = Math.abs(offsetY) - innerY
      const cornerX = Math.max(qx, 0)
      const cornerY = Math.max(qy, 0)
      const corner = Math.hypot(cornerX, cornerY)
      // rounded rect signed distance, positive inside the lens
      const depth = radius - corner - Math.min(Math.max(qx, qy), 0)
      const strength = depth > 0 && depth < LENS_BAND ? (1 - depth / LENS_BAND) ** 2 : 0
      const normalX = corner > 0 ? cornerX / corner : qx > qy ? 1 : 0
      const normalY = corner > 0 ? cornerY / corner : qx > qy ? 0 : 1
      // edge pixels sample toward the lens center
      const index = (py * width + px) * 4
      image.data[index] = 128 - Math.sign(offsetX) * normalX * strength * 127
      image.data[index + 1] = 128 - Math.sign(offsetY) * normalY * strength * 127
      image.data[index + 2] = 128
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

export const SchemaGraphMiniMap = () => {
  const baseId = useId()

  const canvasAspect = useStore((s) =>
    s.width > 0 && s.height > 0 ? s.height / s.width : MINIMAP_MAX_HEIGHT / MINIMAP_MAX_WIDTH
  )
  const width = Math.round(Math.min(MINIMAP_MAX_WIDTH, MINIMAP_MAX_HEIGHT / canvasAspect))
  const height = Math.round(width * canvasAspect)

  // react flow cuts a square hole in its mask. this repeats its minimap math for a rounded hole
  const viewport = useStore(
    (s): Rect => {
      const [tx, ty, zoom] = s.transform
      const view = { x: -tx / zoom, y: -ty / zoom, width: s.width / zoom, height: s.height / zoom }
      const nodes = Array.from(s.nodeLookup.values()).filter((node) => !node.hidden)
      const nodesBounds =
        nodes.length > 0 ? getNodesBounds(nodes, { nodeLookup: s.nodeLookup }) : view
      const x = Math.min(view.x, nodesBounds.x)
      const y = Math.min(view.y, nodesBounds.y)
      const boundsWidth = Math.max(view.x + view.width, nodesBounds.x + nodesBounds.width) - x
      const boundsHeight = Math.max(view.y + view.height, nodesBounds.y + nodesBounds.height) - y
      const scale = Math.max(boundsWidth / width, boundsHeight / height)
      // the canvas has no size before the first measure
      if (!(scale > 0)) return { x: 0, y: 0, width, height }
      return {
        x: (view.x - x) / scale + (width - boundsWidth / scale) / 2,
        y: (view.y - y) / scale + (height - boundsHeight / scale) / 2,
        width: view.width / scale,
        height: view.height / scale,
      }
    },
    (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
  const { x, y, width: w, height: h } = viewport
  // a large schema gives a small viewport, so the radius and the lens shrink with it
  const r = Math.min(VIEWPORT_RADIUS, w / 2, h / 2)
  const lensScale = (LENS_SCALE * Math.min(1, Math.min(w, h) / (2 * LENS_BAND))) / width
  const maskPath = [
    `M0 0H${width}V${height}H0Z`,
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join('')

  // memo stops parent renders from building the map again
  const lensMap = useMemo(
    () => getLensMap({ width, height, lens: { x, y, width: w, height: h }, radius: r }),
    [width, height, x, y, w, h, r]
  )
  // safari caches a filter by id, so the id changes with the map
  const lensId = `${baseId}-lens-${Math.round(x)}-${Math.round(y)}-${Math.round(w)}-${Math.round(h)}`

  return (
    <>
      {lensMap ? (
        <svg aria-hidden className="absolute size-0">
          <filter
            id={lensId}
            x="0"
            y="0"
            width="1"
            height="1"
            primitiveUnits="objectBoundingBox"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={lensMap}
              x="0"
              y="0"
              width="1"
              height="1"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={lensScale * 1.05}
              xChannelSelector="R"
              yChannelSelector="G"
              result="red"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={lensScale}
              xChannelSelector="R"
              yChannelSelector="G"
              result="green"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={lensScale * 0.95}
              xChannelSelector="R"
              yChannelSelector="G"
              result="blue"
            />
            <feColorMatrix in="red" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r" />
            <feColorMatrix in="green" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g" />
            <feColorMatrix in="blue" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
        </svg>
      ) : null}
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        bgColor="var(--card)"
        nodeColor="var(--input)"
        maskColor="transparent"
        offsetScale={0}
        style={{ width, height, filter: lensMap ? `url(#${lensId})` : undefined }}
        className="rounded-md overflow-hidden mr-2.75! mb-11!"
      />
      <Panel
        position="bottom-right"
        style={{ width, height }}
        className="floating-surface-shadow-xs pointer-events-none rounded-md overflow-hidden mr-2.75! mb-11!"
      >
        <div
          style={{ clipPath: `path(evenodd, '${maskPath}')` }}
          className="size-full bg-foreground/5"
        />
        <svg aria-hidden width={width} height={height} className="absolute inset-0">
          <rect
            x={x + 0.25}
            y={y + 0.25}
            width={w - 0.5}
            height={h - 0.5}
            rx={r - 0.25}
            fill="none"
            strokeWidth={0.5}
            className="stroke-border"
          />
        </svg>
      </Panel>
    </>
  )
}
