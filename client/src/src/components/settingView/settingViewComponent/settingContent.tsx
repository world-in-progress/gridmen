import SettingItem from "./settingItem"
import { Input } from "@/components/ui/input"
import { useSettingStore } from "../settingStore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface SettingContentProps {
    activeCategory: string
}

export default function SettingContent({ activeCategory }: SettingContentProps) {

    const { highSpeedMode, setHighSpeedMode } = useSettingStore()
    const { leadIP, setLeadIP } = useSettingStore()

    const renderPublicSetting = () => (
        <div className="space-y-0">
            <SettingItem title="Lead IP" description="Control the lead IP. e.g: http://127.0.0.1:8000">
                <Input
                    defaultValue="http://127.0.0.1:8000"
                    className="w-64 bg-gray-700 border-gray-600 text-white"
                    onChange={(e) => setLeadIP(e.target.value)}
                />
            </SettingItem>
        </div >
    )

    const renderGeneralSetting = () => (
        <div className="space-y-0">
            <SettingItem title="Topology: High Speed" description="Control whether to enable high-speed operations.">
                <Select
                    value={highSpeedMode ? "on" : "off"}
                    onValueChange={(value) => setHighSpeedMode(value === "on")}
                >
                    <SelectTrigger className="w-32 bg-gray-700 border-gray-600">
                        <SelectValue placeholder="Off" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                    </SelectContent>
                </Select>
            </SettingItem>
        </div>
    )



    const getSettingContent = () => {
        switch (activeCategory) {
            case "public-tree":
            case "lead-ip":
                return renderPublicSetting()
            case "general":
            case "topology-editor":
                return renderGeneralSetting()
            default:
                return (
                    <div className="text-center py-12">
                        <p className="text-gray-400">Select a setting category from the left to view related options</p>
                    </div>
                )
        }
    }

    return (
        <div className="flex-1 bg-[#1E1E1E]">
            <div className=" px-6 py-4">
                <div className="flex space-x-6">
                    <button className="text-blue-400 border-b-2 border-blue-400 pb-2">User</button>
                    <button className="text-gray-400 hover:text-white pb-2">Workspace</button>
                </div>
            </div>

            <div className="px-6 py-4">
                <div className="mb-6">
                    <h2 className="text-xl font-semibold text-white mb-2">Commonly Used</h2>
                    <p className="text-sm text-gray-400">These are the most commonly used settings.</p>
                </div>

                <div className="max-w-4xl">{getSettingContent()}</div>
            </div>
        </div>
    )
}
