import mongoose from 'mongoose'
import { env } from './env.ts'

export async function connectDb(uri: string = env.mongoUri): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  console.log(`[backoffice] connected to MongoDB (${new URL(uri.replace('mongodb://', 'http://')).pathname.slice(1) || 'default'})`)
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect()
}
