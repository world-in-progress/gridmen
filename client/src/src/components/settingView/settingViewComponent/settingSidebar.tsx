import { useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"

interface SettingCategory {
    id: string
    name: string
    icon?: string
    subcategories?: SettingCategory[]
}

const settingCategories: SettingCategory[] = [
    {
        id: "public-tree",
        name: "Public Tree",
        subcategories: [
            { id: "lead-ip", name: "Lead IP" },
        ],
    },
    {
        id: "map-view",
        name: "Map View",
        subcategories: [
            { id: "map-view-general", name: "General" },
        ],
    },
    {
        id: "topology-editor",
        name: "Topology Editor",
        subcategories: [
            { id: "controlling", name: "Controlling" }
        ],
    }
]

interface SettingSidebarProps {
    activeCategory: string
    onCategoryChange: (categoryId: string) => void
}

export default function SettingSidebar({ activeCategory, onCategoryChange }: SettingSidebarProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["public-tree"]))

    const toggleCategory = (categoryId: string) => {
        const newExpanded = new Set(expandedCategories)
        if (newExpanded.has(categoryId)) {
            newExpanded.delete(categoryId)
        } else {
            newExpanded.add(categoryId)
        }
        setExpandedCategories(newExpanded)
    }

    const renderCategory = (category: SettingCategory, level = 0) => {
        const isExpanded = expandedCategories.has(category.id)
        const isActive = activeCategory === category.id
        const hasSubcategories = category.subcategories && category.subcategories.length > 0

        return (
            <div key={category.id}>
                <div
                    className={`flex items-center px-2 py-1 text-sm cursor-pointer hover:bg-gray-700 ${isActive ? "bg-[#2A2C33] text-white" : "text-gray-300"
                        }`}
                    style={{ paddingLeft: `${8 + level * 16}px` }}
                    onClick={() => {
                        if (hasSubcategories) {
                            toggleCategory(category.id)
                        } else {
                            onCategoryChange(category.id)
                        }
                    }}
                >
                    {hasSubcategories && (
                        <div className="mr-1">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                    )}
                    <span className={hasSubcategories ? "" : "ml-5"}>{category.name}</span>
                </div>
                {hasSubcategories && isExpanded && (
                    <div>{category.subcategories!.map((subcategory) => renderCategory(subcategory, level + 1))}</div>
                )}
            </div>
        )
    }

    return (
        <div className="w-64 bg-[#1E1E1E] border-r border-gray-700 overflow-y-auto">
            <div className="p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Settings</h3>
                <div className="space-y-1">{settingCategories.map((category) => renderCategory(category))}</div>
            </div>
        </div>
    )
}
