import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingState {
    leadIP: string | null
    highSpeedMode: boolean
}

interface SettingActions {
    setHighSpeedMode: (highSpeedMode: boolean) => void
    setLeadIP: (leadIP: string) => void
}

type SettingStore = SettingState & SettingActions

export const useSettingStore = create<SettingStore>((set) => ({
    leadIP: null,
    highSpeedMode: false,
    setLeadIP: (leadIP: string) => set({ leadIP }),
    setHighSpeedMode: (highSpeedMode: boolean) => set({ highSpeedMode }),
}))