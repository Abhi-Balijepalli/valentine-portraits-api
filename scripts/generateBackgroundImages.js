import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const outputDir = path.join(__dirname, '..', '..', 'client', 'public', 'slideshow')

// Phone portrait wallpaper prompts - romantic, aesthetic, feminine
const prompts = [
  "Soft pink rose petals floating on water, dreamy aesthetic phone wallpaper, soft bokeh, romantic Valentine vibes, vertical composition",
  "Pastel pink and gold marble texture with delicate gold veins, luxury aesthetic, elegant phone wallpaper, feminine and romantic",
  "Cherry blossom branches against soft pink gradient sky, Japanese aesthetic, dreamy spring wallpaper, vertical phone format",
  "Soft pink clouds at golden hour sunset, cotton candy sky, dreamy aesthetic phone wallpaper, romantic atmosphere",
  "Elegant pink peonies bouquet with soft lighting, romantic floral aesthetic, luxury phone wallpaper, feminine design",
  "Rose gold glitter and sparkles on pink background, glamorous aesthetic, luxury phone wallpaper, celebration vibes",
  "Soft pink silk fabric flowing with gentle folds, luxury texture, elegant phone wallpaper, feminine aesthetic",
  "Pink hearts bokeh lights on soft background, romantic Valentine phone wallpaper, dreamy and magical",
  "Lavender field at sunset with soft purple pink tones, romantic landscape phone wallpaper, peaceful aesthetic",
  "Delicate pink butterfly wings macro detail, nature aesthetic, soft feminine phone wallpaper, ethereal beauty",
  "Pink champagne bubbles rising, celebration aesthetic, luxury phone wallpaper, romantic and festive",
  "Soft pink watercolor wash with gold accents, artistic abstract phone wallpaper, feminine and elegant",
  "Dreamy pink neon lights reflection on water, modern aesthetic phone wallpaper, romantic city vibes",
  "Pink tulips garden at sunrise with morning dew, fresh spring phone wallpaper, romantic floral aesthetic",
  "Rose quartz crystal close-up with soft pink glow, healing aesthetic phone wallpaper, feminine and mystical",
  "Soft pink feathers floating on dreamy background, delicate aesthetic phone wallpaper, romantic and light",
  "Pink macarons tower with gold dust, dessert aesthetic phone wallpaper, luxury and sweet feminine vibes",
  "Starry night sky with pink aurora borealis, magical phone wallpaper, romantic celestial aesthetic",
  "Pink lotus flower floating on calm water, zen aesthetic phone wallpaper, peaceful and romantic",
  "Soft pink gradient with scattered rose gold stars, minimalist phone wallpaper, elegant feminine aesthetic"
]

async function generateImage(prompt, index) {
  try {
    console.log(`Generating image ${index + 1}/20: ${prompt.substring(0, 50)}...`)

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp-image-generation',
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    })

    const fullPrompt = `Create a stunning phone wallpaper image in PORTRAIT orientation (9:16 aspect ratio):

${prompt}

Requirements:
- Portrait/vertical orientation like a phone screen
- Ultra high quality, 4K aesthetic
- Soft, feminine, romantic mood
- Perfect for Valentine's Day theme
- Elegant and sophisticated
- Soft pink, rose gold, and blush tones
- Dreamy and aesthetic vibes
- No text or words in the image`

    const result = await model.generateContent(fullPrompt)
    const response = await result.response

    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const buffer = Buffer.from(part.inlineData.data, 'base64')
          const filename = `bg-${String(index + 1).padStart(2, '0')}.jpg`
          const filepath = path.join(outputDir, filename)
          await fs.writeFile(filepath, buffer)
          console.log(`  ✓ Saved: ${filename}`)
          return filename
        }
      }
    }
    throw new Error('No image in response')
  } catch (error) {
    console.error(`  ✗ Failed image ${index + 1}:`, error.message)
    return null
  }
}

async function main() {
  console.log('🎨 Generating Valentine\'s Phone Wallpapers\n')

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true })

  const results = []

  // Generate images with delay to avoid rate limiting
  for (let i = 0; i < prompts.length; i++) {
    const filename = await generateImage(prompts[i], i)
    if (filename) {
      results.push(filename)
    }
    // Small delay between requests
    if (i < prompts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  console.log(`\n✨ Generated ${results.length}/20 wallpapers`)

  // Create a manifest file
  const manifest = {
    images: results,
    generatedAt: new Date().toISOString()
  }
  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  console.log('📝 Created manifest.json')
}

main().catch(console.error)
