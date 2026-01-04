import { LoginForm } from "./loginForm"
import login from '/images/login.svg'

interface LoginPageProps {
    onLogin: () => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
    return (
        <div className="flex-1 h-full bg-[#1E1E1E] text-white">
            <div className="flex h-full flex-row">
                <div className="flex flex-col w-1/3 gap-4 p-6 md:p-10">
                    <div className="flex flex-1 items-center justify-center">
                        <div className="w-2/3 max-w-lg">
                            <LoginForm onLogin={onLogin} />
                        </div>
                    </div>
                </div>
                <div className="w-2/3 bg-[#303030] flex items-center justify-around">
                    <img
                        src={login}
                        alt="Login background"
                        className="w-[70%] h-[70%] inset-0 object-cover dark:brightness-[0.2] dark:grayscale"
                    />
                </div>
            </div>
        </div>
    )
}
