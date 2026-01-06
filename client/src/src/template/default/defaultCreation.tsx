import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { FilePlusCorner, FolderTree } from "lucide-react"

const tips = [
    { tip1: "Navigate to the Explorer panel on the left side of the screen." },
    { tip2: "Locate the FilePlus button in the WorkSpace toolbar." },
    { tip3: "Click the FilePlus button to create a new Resource." },
]

export default function DefaultCreation() {
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-none w-full border-b border-gray-700 flex flex-col">
                {/* ------------*/}
                {/* Page Avatar */}
                {/* ------------*/}
                <div className="w-full flex justify-center items-center gap-4 p-4">
                    <Avatar className="h-10 w-10 border-2 border-white">
                        <AvatarFallback className="bg-[#007ACC]">
                            <FolderTree className="h-6 w-6 text-white" />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className="font-bold text-[25px] relative flex items-center">Create New Resource</h1>
                </div>
                {/* -----------------*/}
                {/* Page Description */}
                {/* -----------------*/}
                <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                    {/* ----------*/}
                    {/* Page Tips */}
                    {/* ----------*/}
                    <div className="text-sm px-4">
                        <ul className="list-disc space-y-1">
                            {tips.map((tip, index) => (
                                <li key={index}>{Object.values(tip)[0]}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                <div className="w-2/3 mx-auto mt-8 mb-4 space-y-4 pb-4">
                    {/* -------------------- */}
                    {/* Instruction Card */}
                    {/* -------------------- */}
                    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="p-4 bg-blue-50 rounded-full">
                                <FilePlusCorner className="h-12 w-12 text-[#007ACC]" />
                            </div>
                            <h2 className="text-black text-lg font-semibold">No Resource Selected</h2>
                            <p className="text-gray-600 text-sm max-w-md">
                                To create a new Resource, please click the{" "}
                                <span className="font-semibold text-[#007ACC]">FilePlus</span> button located in the Explorer panel on
                                the left side of the screen.
                            </p>
                            <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 w-full">
                                <p className="text-gray-500 text-xs">
                                    Tip: You can also right-click on a folder in the Explorer to access the context menu for more options.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
