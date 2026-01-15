import { IViewContext } from '@/views/IViewContext'
import React from 'react'
import { IResourceNode } from '../scene/iscene'

interface VectorCreationProps {
    node: IResourceNode
    context: IViewContext
}

export default function VectorCreation({ node, context }: VectorCreationProps) {
    return (
        <div>VectorCreation</div>
    )
}
