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