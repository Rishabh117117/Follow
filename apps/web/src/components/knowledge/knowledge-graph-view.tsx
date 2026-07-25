'use client'

import { useRef, useEffect, useState, useCallback } from 'react'

interface GraphNode {
  id: string
  type: string
  connectionCount: number
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  relationship: string
  weight: number
}

interface KnowledgeGraphViewProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick?: (nodeId: string, nodeType: string) => void
  searchHighlight?: string
}

const TYPE_COLORS: Record<string, string> = {
  user: '#8B5CF6',
  file: '#3B82F6',
  topic: '#10B981',
  decision: '#F59E0B',
  project: '#EC4899',
}

export function KnowledgeGraphView({
  nodes,
  edges,
  onNodeClick,
  searchHighlight,
}: KnowledgeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(
    new Map()
  )

  // Initialize positions with simple force layout
  useEffect(() => {
    const positions = positionsRef.current
    const centerX = 400
    const centerY = 300

    // Place nodes in a circle initially
    nodes.forEach((node, i) => {
      if (!positions.has(node.id)) {
        const angle = (2 * Math.PI * i) / nodes.length
        const radius = 150 + Math.random() * 50
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        })
      }
    })

    // Simple force simulation (30 iterations)
    for (let iter = 0; iter < 30; iter++) {
      // Repulsion between all nodes
      const nodeList = [...positions.entries()]
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const [, a] = nodeList[i]!
          const [, b] = nodeList[j]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 5000 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const a = positions.get(edge.sourceId)
        const b = positions.get(edge.targetId)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 120) * 0.01
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      // Apply velocities with damping
      for (const [, pos] of positions) {
        pos.x += pos.vx * 0.5
        pos.y += pos.vy * 0.5
        pos.vx *= 0.8
        pos.vy *= 0.8
      }
    }
  }, [nodes, edges])

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * 2
    canvas.height = height * 2
    ctx.scale(2, 2)

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#09090B'
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.translate(viewport.x, viewport.y)
    ctx.scale(viewport.scale, viewport.scale)

    const positions = positionsRef.current

    // Draw edges
    for (const edge of edges) {
      const src = positions.get(edge.sourceId)
      const tgt = positions.get(edge.targetId)
      if (!src || !tgt) continue

      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle =
        hoveredNode === edge.sourceId || hoveredNode === edge.targetId
          ? 'rgba(139, 92, 246, 0.6)'
          : 'rgba(63, 63, 70, 0.4)'
      ctx.lineWidth = edge.weight * 2
      ctx.stroke()
    }

    // Draw nodes
    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue

      const radius = 8 + Math.min(node.connectionCount * 2, 20)
      const color = TYPE_COLORS[node.type] ?? '#71717A'
      const isHighlighted = searchHighlight && node.id.includes(searchHighlight)
      const isHovered = hoveredNode === node.id

      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isHighlighted ? '#EAB308' : color
      ctx.globalAlpha = isHovered ? 1 : 0.8
      ctx.fill()
      ctx.globalAlpha = 1

      if (isHovered || isHighlighted) {
        ctx.strokeStyle = 'white'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Label
      ctx.fillStyle = '#D4D4D8'
      ctx.font = '11px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(node.id.slice(0, 12), pos.x, pos.y + radius + 14)
    }

    ctx.restore()
  }, [nodes, edges, viewport, hoveredNode, searchHighlight])

  useEffect(() => {
    render()
  }, [render])

  // Mouse handlers
  const getMousePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (e.clientX - rect.left - viewport.x) / viewport.scale,
      y: (e.clientY - rect.top - viewport.y) / viewport.scale,
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setViewport((v) => ({
        ...v,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      }))
      return
    }

    // Check hover
    const { x, y } = getMousePos(e)
    const positions = positionsRef.current
    let found: string | null = null
    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      const dist = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2)
      if (dist < 15 + node.connectionCount * 2) {
        found = node.id
        break
      }
    }
    setHoveredNode(found)
  }

  const handleMouseUp = (_e: React.MouseEvent) => {
    setIsDragging(false)
    if (hoveredNode && onNodeClick) {
      const node = nodes.find((n) => n.id === hoveredNode)
      if (node) onNodeClick(node.id, node.type)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setViewport((v) => ({
      ...v,
      scale: Math.max(0.2, Math.min(3, v.scale * delta)),
    }))
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex gap-3 rounded-lg bg-zinc-900/90 px-3 py-2 text-xs">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="capitalize text-zinc-400">{type}</span>
          </div>
        ))}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex gap-1">
        <button
          onClick={() => setViewport((v) => ({ ...v, scale: Math.min(3, v.scale * 1.2) }))}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          +
        </button>
        <button
          onClick={() => setViewport((v) => ({ ...v, scale: Math.max(0.2, v.scale * 0.8) }))}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          −
        </button>
        <button
          onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
