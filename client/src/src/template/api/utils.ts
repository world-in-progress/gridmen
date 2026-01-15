export function extractIPFromUrl(url: string): string {
    try {
        const urlObj = new URL(url)
        return `${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}`
    } catch {
        return url.replace(/^https?:\/\//, '')
    }
}

export function decodeNodeInfo(nodeInfo: string): { address: string, nodeKey: string} {
    console.log('decodeNodeInfo...', nodeInfo)
    const isRemote = nodeInfo.includes('::')
    if (isRemote) {
        const [address, nodeKey] = nodeInfo.split('::')
        if (address.startsWith('http://') || address.startsWith('https://')) {
            return { address, nodeKey }
        } else {
            throw new Error(`Invalid address format in nodeInfo: ${nodeInfo}`)
        }
    } else {
        const address = import.meta.env.VITE_API_BASE_URL
        if (address) {
            return { address, nodeKey: nodeInfo }
        } else {
            return { address: 'http://127.0.0.1:8000', nodeKey: nodeInfo }
        }
    }
}