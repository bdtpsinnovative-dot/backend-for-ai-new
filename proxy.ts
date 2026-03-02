import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 1. เปลี่ยนชื่อฟังก์ชันจาก middleware เป็น proxy
export function proxy(request: NextRequest) {
  // สร้าง response
  const response = NextResponse.next()

  // ✅ ตั้งค่า CORS เพื่อให้ Flutter Web (localhost) หรือ Domain อื่นเรียกใช้ได้
  response.headers.set('Access-Control-Allow-Origin', '*') 
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

  // จัดการ Pre-flight request (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: response.headers })
  }

  return response
}

// กำหนดให้ Proxy ทำงานเฉพาะกับ API เท่านั้น
export const config = {
  matcher: '/api/:path*',
}