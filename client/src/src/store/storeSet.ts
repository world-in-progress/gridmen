import { create } from 'zustand'
import { Layer, LayerStore, SelectedNodeStore, SettingsProps, TempNewNodeProps, ToolPanelStore } from "./storeTypes"
import { ResourceNode } from '@/template/scene/scene'

export const DEFAULT_LEAD_IP = 'http://127.0.0.1:8001'

export const useSettingStore = create<SettingsProps>((set) => ({
    publicIP: DEFAULT_LEAD_IP,
    highSpeedMode: false,
    setLeadIP: (leadIP: string) => set({ publicIP: leadIP }),
    setHighSpeedMode: (highSpeedMode: boolean) => set({ highSpeedMode }),
}))

export const useSelectedNodeStore = create<SelectedNodeStore>((set) => ({
    selectedNodeKey: null,
    setSelectedNodeKey: (key: string | null) => set({ selectedNodeKey: key }),
}))

export const useTempNodeStore = create<TempNewNodeProps>((set) => ({
    tempNewNodeKey: null,
    setTempNewNodeKey: (key: string) => set({ tempNewNodeKey: key })
}))

const DEFAULT_LAYERS: Layer[] = [
    {
        id: "resource-node",
        name: "Resource Node",
        visible: true,
        type: "group",
        children: [],
    },
]

export const useLayerStore = create<LayerStore>((set) => ({
    layers: DEFAULT_LAYERS,
    setLayers: (next) => {
        set((state) => ({
            layers: typeof next === 'function' ? next(state.layers) : next,
        }))
    },
    addSchemaLayerToResourceNode: (node: ResourceNode) => {
        const nextLayer: Layer = {
            id: node.key,
            name: node.key.split('.').slice(-1)[0],
            visible: true,
            type: "Layer",
            template: node.template_name,
        }

        const resourceGroup: Layer = {
            id: "resource-node",
            name: "Resource Node",
            visible: true,
            type: "group",
            children: [],
        }

        set((state) => {
            const update = (layers: Layer[]): Layer[] => {
                const hasGroup = layers.some((l) => l.name === "Resource Node" && l.type === "group")
                const ensured = hasGroup
                    ? layers
                    : [
                        ...layers,
                        resourceGroup,
                    ]

                return ensured.map((layer) => {
                    if (layer.name !== "Resource Node" || layer.type !== "group") {
                        return layer
                    }

                    const children = layer.children ?? []
                    const exists = children.some((c) => c.id === node.key)
                    if (exists) {
                        return layer
                    }

                    return {
                        ...layer,
                        children: [...children, nextLayer],
                    }
                })
            }

            return { layers: update(state.layers) }
        })
    },
}))

export const useToolPanelStore = create<ToolPanelStore>((set) => ({
    activeTab: 'create',
    setActiveTab: (tab) => set({ activeTab: tab }),
}))