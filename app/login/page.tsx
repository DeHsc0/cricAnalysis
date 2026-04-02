"use client"

import { CircleChevronDown, Loader } from "lucide-react";
import loginBg from "../../public/login_bg.png";
import { useForm } from "react-hook-form";
import { loginSchema } from "@/types/zod";
import z from "zod";
import { toast } from "sonner"
import bcrypt from "bcryptjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage () {

    const router = useRouter()
    const [ loading , setLoading ] = useState<boolean>(false)

    const { register , handleSubmit } = useForm<z.infer<typeof loginSchema>>()

    const onSubmit =async (data : {

        username : string,
        password  : string

    }) => {

        setLoading(true)

        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                username: data.username,
                password: data.password,
            }),
        });

        const responseData = await response.json()

        if(response.status !== 200 ){

            toast(responseData.message)
            setLoading(false)       
            return

        }

        toast("Login Successfull")
        
        router.push("/dashboard")

        setLoading(false)
        
    }

    return (
        <div className="flex h-screen w-screen justify-center items-center" style={{
                background: `linear-gradient(rgba(10, 15, 29, 0.5), rgba(10, 15, 29, 0.85)), url('${loginBg.src}')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}>

            <div className="px-6 py-4 bg-[#0f172acc] w-96 flex flex-col gap-4 justify-center items-center rounded-lg border border-[#ffffff1a] " >

                
                <CircleChevronDown className="text-[#3b82f6] size-12"/>

                <div className="flex justify-center flex-col items-center">

                    <h1 className="font-semibold text-2xl text-white ">
                        Welcome Back
                    </h1>
                            <p className="text-md text-gray-500/80 ">

                        LOGIN TO YOUR ACCOUNT

                    </p>

                </div>

                <div className="w-full">

                    <form className="flex flex-col  gap-3" onSubmit={handleSubmit((data) => onSubmit(data))}>

                        <div className="flex flex-col gap-2">

                            <label htmlFor="username" className="text-gray-500/80 text-xs text-start font-semibold" >
                                USERNAME
                            </label>

                            <input required { ...register("username" , {required : true })} className="py-2 px-3 text-sm placeholder:text-sm border bg-white rounded-lg border-[#ffffff1a] " placeholder="eg. Virat"/>


                        </div>

                        <div className="flex flex-col gap-2 mt-3">

                            <label htmlFor="password" className="text-gray-500/80 text-xs text-start font-semibold " >
                                PASSWORD
                            </label>

                            <input
                                required
                                { ...register("password" , {required : true })}
                                id="password"
                                type="password"
                                className="py-2 px-3 text-sm bg-white placeholder:text-sm border rounded-lg border-[#ffffff1a]"
                                placeholder="Enter your password"
                            />


                        </div>
                        
                        <button type="submit" className="w-full p-3 bg-linear-to-br from-blue-400 to-blue-500 text-white border-0 rounded-[10px] [font-family:var(--font)] text-base font-semibold cursor-pointer transition-all duration-300 ease-in-out flex justify-center items-center shadow-[0_4px_12px_rgba(59,130,246,0.3)] mt-1 hover:from-blue-500 hover:to-blue-600 " disabled={loading}>

                            { loading ? <Loader className="animate-spin text-white" /> : <p>Login</p>   }

                        </button>

                        <p className="text-white font-bold text-xs text-center">
                            Create an Account
                        </p>

                    </form>


                </div>

            </div>

        </div>
    )    

}