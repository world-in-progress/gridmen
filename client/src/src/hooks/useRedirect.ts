import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { RedirectTarget } from "@/registry/iconRegistry"

export function useRedirect({
    isLoggedIn,
    setActiveIconID,
}: {
    isLoggedIn: boolean
    setActiveIconID: (iconID: RedirectTarget) => void
}) {
    const navigate = useNavigate()

    const redirectTo = useCallback((iconID: RedirectTarget) => {
        setActiveIconID(iconID)
        if (!isLoggedIn) {
            navigate('/login')
            return
        }
        navigate('/framework')
    }, [isLoggedIn, navigate, setActiveIconID])

    return { redirectTo }
}