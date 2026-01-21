import type { ReactNode } from "react"

interface SettingItemProps {
    title: string
    description?: string
    children: ReactNode
}

export default function SettingItem({ title, description, children }: SettingItemProps) {
    return (
        <div className=" border-b border-gray-700 last:border-b-0">
            <div className="flex items-start justify-between">
                <div className="flex-1 mr-4">
                    <h3 className="text-sm font-medium text-white mb-1">{title}</h3>
                    {description && <p className="text-xs text-gray-400">{description}</p>}
                </div>
                <div className="flex-shrink-0">{children}</div>
            </div>
        </div>
    )
}
