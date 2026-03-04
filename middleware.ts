import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // 1. เช็กก่อนว่าเป็นการเรียกเข้า API หรือเปล่า
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')

  // 2. 🌟 [ส่วนของ CORS] จัดการ Pre-flight request (OPTIONS) ให้ Flutter Web ทำงานได้
  if (isApiRoute && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      },
    })
  }

  // 3. สร้าง Response ตั้งต้น
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  // 4. 🌟 [ส่วนของ Supabase] สร้าง Client ที่รองรับการจำ Cookie (ใช้แพทเทิร์นล่าสุดของ @supabase/ssr)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // คอยเช็คและ "ต่ออายุ" Token ให้อัตโนมัติ
  await supabase.auth.getUser()

  // 5. 🌟 [ส่วนของ CORS] เติม Headers กลับเข้าไปใน Response สุดท้ายสำหรับทุกๆ API Request
  // ต้องเติมตรงนี้เพราะ Supabase อาจจะมีการเขียน Response ทับในขั้นตอน Set Cookie
  if (isApiRoute) {
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  }

  return response
}

export const config = {
  // ให้ Middleware ทำงานกับทุกหน้า (ครอบคลุมทั้งหน้าเว็บปกติและ /api/*)
  // ยกเว้นไฟล์รูปภาพหรือไฟล์ระบบของ Next.js
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}