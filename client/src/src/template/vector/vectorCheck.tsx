import React from 'react'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'

interface VectorCheckProps {
    node: IResourceNode
    context: IViewContext
}

export default function VectorCheck({ node, context }: VectorCheckProps) {
    return (
        <div>VectorCheck</div>
    )
}
