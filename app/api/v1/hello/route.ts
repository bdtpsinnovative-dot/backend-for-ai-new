import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// สร้างตัวเชื่อมต่อกับ Supabase (อยู่ฝั่ง Server ปลอดภัย 100%)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    
    // ตัวอย่าง: รับข้อมูลจาก Flutter มาบันทึกลง Supabase
    // const { data, error } = await supabase.from('test_table').insert(body)

    return NextResponse.json({ 
      message: "Backend พร้อมรับงานจาก Flutter แล้วครับนาย!",
      receivedData: body 
    })
  } catch (error) {
    return NextResponse.json({ error: "ส่งข้อมูลผิดพลาด" }, { status: 400 })
  }
}