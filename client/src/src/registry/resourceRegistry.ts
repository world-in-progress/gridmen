import { Grid, LucideIcon, MapPin, Square } from "lucide-react"

interface ResourceEntry {
    value: string
    label: string
    icon: LucideIcon
}

export const RESOURCE_REGISTRY: ResourceEntry[] = [
    {
        value: "schema",
        label: "Schema",
        icon: MapPin,
    },
    {
        value: "patch",
        label: "Patch",
        icon: Square,
    },
    {
        value: "grid",
        label: "Grid",
        icon: Grid,
    },
]