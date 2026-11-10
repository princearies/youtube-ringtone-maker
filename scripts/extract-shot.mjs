import fs from 'node:fs'

const [input, output] = process.argv.slice(2)
const text = fs.readFileSync(input, 'utf8')
const match = text.match(/"data_base64":"([A-Za-z0-9+/=]+)"/)
if (!match) {
  console.error('no data_base64 in', input)
  process.exit(1)
}
const bytes = Buffer.from(match[1], 'base64')
fs.writeFileSync(output, bytes)
console.log(`wrote ${bytes.length} bytes -> ${output}`)
