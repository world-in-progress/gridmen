import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingState {
    publicIP: string | null
    highSpeedMode: boolean
}

interface SettingActions {
    setHighSpeedMode: (highSpeedMode: boolean) => void
    setLeadIP: (leadIP: string) => void
}

type SettingStore = SettingState & SettingActions

export const DEFAULT_LEAD_IP = 'http://127.0.0.1:8000'

export const useSettingStore = create<SettingStore>((set) => ({
    publicIP: DEFAULT_LEAD_IP,
    highSpeedMode: false,
    setLeadIP: (leadIP: string) => set({ publicIP: leadIP }),
    setHighSpeedMode: (highSpeedMode: boolean) => set({ highSpeedMode }),
}))