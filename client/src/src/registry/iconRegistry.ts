import { IconEntry } from "@/components/iconBar"
import { Settings, Combine, Languages, User, Map, ChartArea, Bot } from 'lucide-react'

export const ICON_REGISTRY: IconEntry[] = [
    { id: 'map-view', icon: Map, label: 'Map View' },
    { id: 'table-view', icon: ChartArea, label: 'Table View' },
    { id: 'settings', icon: Settings, label: 'Settings' },
    { id: 'ai', icon: Bot, label: 'AI', style: 'mt-auto' },
    { id: 'languages', icon: Languages, label: 'Languages' },
    { id: 'user', icon: User, label: 'User', style: '!border-blue-500' }
]