"use client"

import Image from "next/image"
import { useState } from "react"

export default function AvatarImage({
  src, name, width, height, className,
}: {
  src: string; name: string; width: number; height: number; className?: string;
}) {
  const [errored, setErrored] = useState(false)
  if (errored) return <>{name.charAt(0).toUpperCase()}</>
  return (
    <Image
      src={src}
      alt={name}
      width={width}
      height={height}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}
