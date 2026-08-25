import { redirect } from "next/navigation"

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/listings/${id}`)
}
