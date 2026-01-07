import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { FilePlusIcon as FilePlusCorner, FolderTree, Info } from "lucide-react"

const tips = [
    { tip1: "Select or create resource nodes from the left EXPLORER panel" },
    { tip2: "Create new resources using the FilePlus button in the WorkSpace toolbar" },
    { tip3: "You can view, edit, and manage resource nodes" },
]

export default function DefaultPage() {
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                <div className="flex-none w-full border-b border-gray-700 flex flex-col">
                    {/* ------------*/}
                    {/* Page Avatar */}
                    {/* ------------*/}
                    <div className="w-full flex justify-center items-center gap-4 px-4 pt-4">
                        <Avatar className="h-10 w-10 border-2 border-white">
                            <AvatarFallback className="bg-[#007ACC]">
                                <FolderTree className="h-6 w-6 text-white" />
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-1">
                            <h1 className="font-bold text-[25px] tracking-tight">Node Management System</h1>
                            <p className="text-sm  font-medium">Academic Research Prototype Platform</p>
                        </div>
                    </div>
                    {/* -----------------*/}
                    {/* Page Description */}
                    {/* -----------------*/}
                    <div className="w-full px-6 py-2 space-y-2 text-slate-700">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-1 space-y-3">
                                    <p className="text-sm leading-relaxed text-slate-700">
                                        This academic research prototype enables efficient resource node management. Use the left{" "}
                                        <span className="font-semibold text-slate-900">EXPLORER</span> panel to create, view, and edit nodes. It supports
                                        hierarchical organization of experimental data, documents, and config files.
                                    </p>
                                    <div className="text-sm space-y-1.5 pt-2 border-t border-slate-200">
                                        <p className="font-semibold text-slate-800 mb-2">Operation Guide:</p>
                                        <ul className="list-none space-y-1.5 ml-1">
                                            {tips.map((tip, index) => (
                                                <li key={index} className="flex items-start gap-2">
                                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-xs font-medium flex-shrink-0 mt-0.5">
                                                        {index + 1}
                                                    </span>
                                                    <span className="text-slate-600 leading-relaxed">{Object.values(tip)[0]}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="w-full mx-auto space-y-2 px-6 pt-2 pb-4">
                    <div className="bg-white rounded-lg  overflow-hidden">
                        <div className="bg-slate-700 px-4 py-2">
                            <h2 className="text-white text-lg font-semibold tracking-tight">Current Status</h2>
                        </div>
                        <div className="p-4">
                            <div className="flex flex-col items-center text-center gap-4">
                                <div className="p-4 bg-slate-100 rounded-full border-2 border-slate-200">
                                    <FilePlusCorner className="h-10 w-10 text-slate-600" />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-slate-900 text-xl font-semibold">No Resource Node Selected</h3>
                                    <p className="text-slate-500 text-base">Please create or select a node to begin</p>
                                </div>
                                <p className="text-slate-600 text-sm max-w-lg leading-relaxed">
                                    To create a new resource node, please click the{" "}
                                    <span className="inline-flex items-center mx-1 px-2 py-0.5 bg-slate-700 text-white text-xs font-semibold rounded">
                                        FilePlus
                                    </span>{" "}
                                    button in the left Explorer panel. The system will guide you through the resource node initialization
                                    configuration process, including node type selection, property definition, and relationship settings.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-blue-50 rounded-lg">
                                <Info className="h-4 w-4 text-blue-600" />
                            </div>
                            <div className="flex-1 space-y-2">
                                <h4 className="text-slate-900 font-semibold">System Features</h4>
                                <p className="text-slate-600 text-sm leading-relaxed">
                                    Resource nodes are the core data units of this system, supporting various types of academic resource
                                    management, including but not limited to: experimental datasets, research literature, configuration
                                    parameters, analysis results, etc. Each node can be configured with metadata, tags, and access
                                    permissions to meet the needs of different research scenarios.
                                </p>
                                <div className="mt-3 pt-3 border-t border-slate-200">
                                    <p className="text-xs text-slate-500">
                                        Tip: Right-click on folders in the Explorer to access more advanced options and batch operation
                                        features.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
