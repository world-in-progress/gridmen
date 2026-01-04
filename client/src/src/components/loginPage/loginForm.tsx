"use client"

import type React from "react"
import { useState } from "react"
import { cn } from "@/utils/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EyeIcon, EyeOffIcon, Mail, Lock } from "lucide-react"

interface LoginFormProps extends React.ComponentProps<"form"> {
    onLogin: () => void
}

export function LoginForm({ className, onLogin, ...props }: LoginFormProps) {
    const [showPassword, setShowPassword] = useState(false)
    const [rememberMe, setRememberMe] = useState(false)

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        onLogin && onLogin()
    }

    return (
        <div className={cn("w-full", className)}>
            <div className="text-center mb-4 space-y-2">
                <h1 className="text-3xl font-bold text-white">Login to your account</h1>
                <p className="text-muted-foreground">OpenGMS Studio</p>
            </div>

            <div className="bg-white rounded-lg p-8 border border-gray-200 shadow-sm">
                <form onSubmit={handleSubmit} className="space-y-5" {...props}>
                    <div className="space-y-2">
                        <Label htmlFor="email" className="text-gray-900 text-sm font-medium">
                            Email
                        </Label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="Enter your Email"
                                required
                                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 h-12 pl-11 focus:border-blue-500 focus:ring-blue-500/20"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-gray-900 text-sm font-medium">
                            Password
                        </Label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                            <Input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your Password"
                                required
                                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 h-12 pl-11 pr-11 focus:border-blue-500 focus:ring-blue-500/20"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 bg-white text-blue-500 focus:ring-blue-500 focus:ring-offset-0 focus:ring-2 cursor-pointer"
                            />
                            <span className="text-gray-700 group-hover:text-gray-900 transition-colors">Remember me</span>
                        </label>
                        <a href="#" className="text-blue-500 hover:text-blue-600 font-medium transition-colors">
                            Forgot password?
                        </a>
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-black text-white hover:bg-gray-800 h-10 font-medium text-base transition-colors border-0 rounded-lg cursor-pointer flex items-center justify-center"
                    >
                        Sign In
                    </Button>

                    <div className="flex items-center gap-3 text-sm">
                        <div className="flex-1 border-t border-gray-300" />
                        <span className="text-gray-500">Or With</span>
                        <div className="flex-1 border-t border-gray-300" />
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        className="w-full bg-white border-gray-300 text-gray-900 hover:bg-gray-50 h-10 font-medium text-base transition-colors rounded-lg cursor-pointer flex items-center justify-center"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 mr-2">
                            <path
                                d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                                fill="currentColor"
                            />
                        </svg>
                        Login with GitHub
                    </Button>

                    <div className="text-center pt-2">
                        <span className="text-gray-600 text-sm">
                            Don't have an account?{" "}
                            <a href="#" className="text-blue-500 hover:text-blue-600 font-medium transition-colors">
                                Sign Up
                            </a>
                        </span>
                    </div>
                </form>
            </div>
        </div>
    )
}
