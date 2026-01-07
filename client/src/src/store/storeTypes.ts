import { ResourceNode } from "@/template/scene/scene";

export interface SelectedNodeStore {
    selectedNodeKey: string | null;
    setSelectedNodeKey: (key: string | null) => void;
}

export interface SettingsProps {
    publicIP: string | null
    highSpeedMode: boolean
    setHighSpeedMode: (highSpeedMode: boolean) => void
    setLeadIP: (leadIP: string) => void
}

export interface TempNewNodeProps {
    tempNewNodeKey: string | null
    setTempNewNodeKey: (tempNewNodeKey: string) => void
}

export type LayerType = "Layer" | "group"

export interface Layer {
    id: string
    name: string
    visible: boolean
    type: LayerType
    children?: Layer[]
    opacity?: number
    template?: string
    node: ResourceNode | null
}

export interface LayerStore {
    layers: Layer[]
    setLayers: (next: Layer[] | ((prev: Layer[]) => Layer[])) => void
    addNodeToLayerGroup: (node: ResourceNode) => void
}

export type ToolPanelTab = 'create' | 'check' | 'edit'

export interface ToolPanelStore {
    activeTab: ToolPanelTab
    setActiveTab: (tab: ToolPanelTab) => void
}