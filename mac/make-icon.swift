// Dibuja el ícono de la app (1024×1024) → PNG
import Cocoa
let size: CGFloat = 1024
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let r = NSRect(x: 100, y: 100, width: 824, height: 824)
let bg = NSBezierPath(roundedRect: r, xRadius: 185, yRadius: 185)
NSGradient(starting: NSColor(calibratedRed: 0.09, green: 0.52, blue: 0.36, alpha: 1),
           ending: NSColor(calibratedRed: 0.03, green: 0.24, blue: 0.17, alpha: 1))!.draw(in: bg, angle: -90)
// cuadrícula tipo plano
NSColor(calibratedWhite: 1, alpha: 0.10).setStroke()
for i in 1..<8 {
    let p = NSBezierPath(); p.lineWidth = 3
    let v = 100 + CGFloat(i) * 103
    p.move(to: NSPoint(x: v, y: 100)); p.line(to: NSPoint(x: v, y: 924))
    p.move(to: NSPoint(x: 100, y: v)); p.line(to: NSPoint(x: 924, y: v)); p.stroke()
}
// hoja
let sheet = NSRect(x: 255, y: 250, width: 514, height: 560)
NSColor.white.setFill()
let sp = NSBezierPath(roundedRect: sheet, xRadius: 22, yRadius: 22); sp.fill()
// dibujo en la hoja
NSColor(calibratedRed: 0.10, green: 0.36, blue: 0.72, alpha: 1).setStroke()
let d = NSBezierPath(); d.lineWidth = 14; d.lineCapStyle = .round; d.lineJoinStyle = .round
d.move(to: NSPoint(x: 310, y: 700)); d.line(to: NSPoint(x: 500, y: 700)); d.line(to: NSPoint(x: 500, y: 560))
d.line(to: NSPoint(x: 710, y: 560)); d.stroke()
let c = NSBezierPath(ovalIn: NSRect(x: 470, y: 670, width: 60, height: 60)); c.lineWidth = 14; c.stroke()
NSColor(calibratedRed: 0.93, green: 0.25, blue: 0.2, alpha: 1).setStroke()
let z = NSBezierPath(); z.lineWidth = 14; z.lineCapStyle = .round
z.move(to: NSPoint(x: 330, y: 470)); z.line(to: NSPoint(x: 700, y: 470)); z.stroke()
// texto DWF
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 150, weight: .heavy),
    .foregroundColor: NSColor(calibratedRed: 0.05, green: 0.16, blue: 0.36, alpha: 1), .paragraphStyle: para]
("DP" as NSString).draw(in: NSRect(x: 255, y: 270, width: 514, height: 180), withAttributes: attrs)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
