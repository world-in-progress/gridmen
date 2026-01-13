import { useSettingStore } from "@/store/storeSet"

export function extractIPFromUrl(url: string): string {
    try {
        const urlObj = new URL(url)
        return `${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}`
    } catch {
        return url.replace(/^https?:\/\//, '')
    }
}

export function getApiBaseUrl(useRemoteIP: boolean = false): string {
    if (useRemoteIP) {
        const publicIP = useSettingStore.getState().publicIP

        if (publicIP && (publicIP.startsWith('http://') || publicIP.startsWith('https://'))) {
            return publicIP
        }

        if (publicIP && !publicIP.startsWith('http')) {
            return `http://${publicIP}`
        }

        const envUrl = import.meta.env.VITE_API_BASE_URL
        if (envUrl) {
            return envUrl
        }

        return 'http://127.0.0.1:8001'
    }

    if (import.meta.env.DEV) {
        return ''
    }

    return 'http://127.0.0.1:8000'
}