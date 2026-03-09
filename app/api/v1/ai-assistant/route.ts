import { NextRequest, NextResponse } from 'next/server';
import { pipeline, env } from '@xenova/transformers';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 🌟 1. ตั้งค่า Environment สำหรับ Vercel (Serverless) โดยเฉพาะ
env.allowLocalModels = false; // ป้องกันการหาโมเดลในโฟลเดอร์ local (Vercel ไม่มี)
env.useBrowserCache = false;  // ปิด Cache ของ Browser เพราะเรารันบน Server

// 🚀 2. บังคับใช้ WASM แทน C++ Binary (แก้ Error libonnxruntime)
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1; // จำกัด Thread ป้องกัน Vercel เมมโมรี่เต็ม
}

let extractor: any = null;

function normalize(vector: number[]) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
}

export async function POST(req: NextRequest) {
    let tempFilePath = '';
    try {
        const formData = await req.formData();
        const imageFile = formData.get('image') as File;
        if (!imageFile) return NextResponse.json({ error: "กรุณาอัปโหลดรูปภาพ" }, { status: 400 });

        // 🌟 โหลดโมเดล (จะถูกโหลดผ่าน WASM แทน Binary)
        if (!extractor) {
            extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
        }
        
        const buffer = Buffer.from(await imageFile.arrayBuffer());
        
        // Vercel อนุญาตให้เขียนไฟล์ลงในโฟลเดอร์ /tmp เท่านั้น (os.tmpdir() ปลอดภัยครับ)
        tempFilePath = path.join(os.tmpdir(), `ai-search-${Date.now()}.jpg`);
        fs.writeFileSync(tempFilePath, buffer); 

        const output = await extractor(tempFilePath);
        const normalizedEmbedding = normalize(Array.from(output.data) as number[]);

        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY! 
        );

        const { data: products, error: dbError } = await supabase.rpc('match_product_variants', {
            query_embedding: normalizedEmbedding, 
            match_threshold: 0.75, 
            match_count: 6 
        });

        if (dbError) throw dbError;

        // 🤖 ถ้าไม่เจอสินค้าในระบบ ให้ Gemini ช่วยตอบ
        if (!products || products.length === 0) {
            const apiKey = process.env.GEMINI_API_KEY;
            const base64Image = buffer.toString("base64");
            
            // 🚨 ดักจับและบังคับเปลี่ยนประเภทไฟล์ให้ Gemini อ่านออก 100%
            let mimeType = imageFile.type;
            if (!mimeType || mimeType === 'application/octet-stream') {
                mimeType = 'image/jpeg'; 
            }

            try {
                // 🚨 เปลี่ยนเป้าหมายไปที่รุ่น gemini-2.5-flash
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: "รูปนี้คือรูปอะไร? ตอบสั้นๆ และบอกว่าสินค้านี้ไม่มีในระบบของ TPS Garden (เพราะเราขายแผ่นลายไม้) ตอบแบบสุภาพ 2 ประโยค" },
                                    {
                                        inline_data: {
                                            mime_type: mimeType,
                                            data: base64Image
                                        }
                                    }
                                ]
                            }]
                        })
                    }
                );

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error.message);
                }

                const aiMessage = data.candidates[0].content.parts[0].text;

                return NextResponse.json({ 
                    message: "ไม่พบสินค้าในระบบ",
                    ai_analysis: aiMessage,
                    products: [] 
                });

            } catch (aiErr: any) {
                console.error("❌ Fetch Gemini Error:", aiErr.message);
                return NextResponse.json({ 
                    message: "ไม่พบสินค้า",
                    ai_analysis: "จากที่ระบบ AI ตรวจสอบ สิ่งนี้ไม่ใช่สินค้าในคลังของเราครับ (TPS Garden ของเราจำหน่ายเฉพาะวัสดุตกแต่งบ้านและลายไม้ครับ)", 
                    products: [] 
                });
            }
        }

        return NextResponse.json({ message: "ค้นหาสำเร็จ!", products: products });

    } catch (error: any) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        console.error("API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}