import { create } from 'zustand'
import { SelectedNodeStore, SettingsProps } from "./storeTypes"

export const useSelectedNodeStore = create<SelectedNodeStore>((set) => ({
    selectedNodeKey: null,
    setSelectedNodeKey: (key: string | null) => set({ selectedNodeKey: key }),
}))

export const DEFAULT_LEAD_IP = 'http://127.0.0.1:8000'

export const useSettingStore = create<SettingsProps>((set) => ({
    publicIP: DEFAULT_LEAD_IP,
    highSpeedMode: false,
    setLeadIP: (leadIP: string) => set({ publicIP: leadIP }),
    setHighSpeedMode: (highSpeedMode: boolean) => set({ highSpeedMode }),
}))