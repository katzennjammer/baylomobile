import { PrismaClient } from "@/generated/prisma/client"
import { PrismaMariaDb } from "@prisma/adapter-mariadb"

function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 3306,
    user: u.username || undefined,
    password: u.password || undefined,
    database: u.pathname.slice(1) || undefined,
  }
}

function createPrismaClient() {
  const adapter = new PrismaMariaDb(parseDbUrl(process.env.DATABASE_URL!))
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

export default prisma
