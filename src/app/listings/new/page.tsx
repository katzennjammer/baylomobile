"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import toast from "react-hot-toast"
import { CATEGORIES, CONDITIONS } from "@/lib/utils"

export default function NewListingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    condition: "",
    valueLeaves: "",
    wantedItems: "",
  })
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  if (status === "loading") return <div className="text-center py-20 text-gray-400">Loading...</div>
  if (!session) {
    router.push("/auth/login")
    return null
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    try {
      const uploaded: string[] = []
      for (const file of files) {
        const data = new FormData()
        data.append("file", file)
        const res = await fetch("/api/upload", { method: "POST", body: data })
        if (!res.ok) throw new Error("Upload failed")
        const json = await res.json()
        uploaded.push(json.url)
      }
      setImages((prev) => [...prev, ...uploaded])
      toast.success("Images uploaded!")
    } catch {
      toast.error("Image upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category || !form.condition) {
      toast.error("Please fill all required fields")
      return
    }
    setLoading(true)
    try {
      // valueLeaves is a string in form state, because that is what a DOM
      // input holds. The API schema is z.number(), so spreading the form
      // straight into the body made every submit carrying a value a 400.
      // Blank means "no value": the field is omitted and the server fills in
      // its suggested value.
      const trimmedValue = form.valueLeaves.trim()
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          valueLeaves: trimmedValue === "" ? null : Number(trimmedValue),
          images,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create listing")
      toast.success("Listing posted!")
      router.push(`/listings/${data.id}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Post an Item</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Item Title <span className="text-red-500">*</span></label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Sony WH-1000XM4 Headphones"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description <span className="text-red-500">*</span></label>
          <textarea
            required
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the item — its features, age, defects, etc."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Category <span className="text-red-500">*</span></label>
            <select
              required
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Select...</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat.charAt(0) + cat.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Condition <span className="text-red-500">*</span></label>
            <select
              required
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Select...</option>
              {CONDITIONS.map((cond) => (
                <option key={cond} value={cond}>{cond.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Estimated Value in Leaves <span className="text-gray-400 font-normal">optional — leave blank to use the suggested value</span></label>
          <input
            type="number"
            min="0"
            value={form.valueLeaves}
            onChange={(e) => setForm({ ...form, valueLeaves: e.target.value })}
            placeholder="e.g. 700"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-gray-500">
            We estimate a value from the category, the condition, and comparable
            completed trades. Your figure has to stay within 25% of that estimate.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">What do you want in return? <span className="text-gray-400 font-normal">optional</span></label>
          <input
            value={form.wantedItems}
            onChange={(e) => setForm({ ...form, wantedItems: e.target.value })}
            placeholder="e.g. Mechanical keyboard, books, gaming mouse..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Photos <span className="text-gray-400 font-normal">optional</span></label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            disabled={uploading}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {uploading && <p className="text-xs text-gray-400 mt-1">Uploading...</p>}
          {images.length > 0 && (
            <p className="text-xs text-emerald-600 mt-1">{images.length} photo{images.length !== 1 ? "s" : ""} uploaded</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || uploading}
          className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Posting..." : "Post Listing"}
        </button>
      </form>
    </div>
  )
}
