import { IViewContext } from '@/views/IViewContext'
import React from 'react'
import { IResourceNode } from '../scene/iscene'

interface VectorEditProps {
    node: IResourceNode
    context: IViewContext
}

export default function VectorEdit({ node, context }: VectorEditProps) {
    return (
        <div>VectorEdit</div>
    )
}
