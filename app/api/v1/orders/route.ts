import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

// เชื่อมต่อ Redis อัตโนมัติจากค่าใน .env
const redis = Redis.fromEnv()

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // ⚡ ขั้นตอนหัวใจสำคัญ: ยัดลงคิว 'order_queue'
    // ใช้เวลาแค่ ~2ms เร็วกว่าเดิมมหาศาล เพราะไม่ต้องรอ Supabase
    await redis.lpush('order_queue', {
      ...body,
      user_id: '38bfe943-d3fd-4e40-ac88-7e39dff9b903', // User ID ของพี่
      created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, message: "รับออเดอร์เข้าคิวแล้ว" })

  } catch (err: any) {
    console.error("Redis Error:", err)
    return NextResponse.json({ error: "ระบบคิวหน่วง" }, { status: 500 })
  }
}