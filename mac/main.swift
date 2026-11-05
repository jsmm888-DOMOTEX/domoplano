// Domoplano — programa de diseño propio de DOMOTEX (app nativa de macOS; motor de dibujo en WKWebView).
// Abre DXF (planchas y modelo), DWF y DWFx. Código propio, sin código ni archivos de Autodesk.
// La interfaz y los lectores de formato están en Resources/web (HTML + JS).
import Cocoa
import WebKit
import UniformTypeIdentifiers

let kScheme = "domoplano"

// Sirve la interfaz (domoplano://app/...), los planos abiertos (__file/<token>) y sus archivos vecinos (__near/<token>/<nombre>).
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let webRoot: URL
    private var files: [String: URL] = [:]
    private let lock = NSLock()

    init(webRoot: URL) { self.webRoot = webRoot }

    func register(_ url: URL) -> String {
        let token = UUID().uuidString
        lock.lock(); files[token] = url; lock.unlock()
        return token
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let host = url.host ?? ""
        var fileURL: URL?
        var mime = "application/octet-stream"
        if host == "file" || url.path.hasPrefix("/__file/") {
            lock.lock(); fileURL = files[url.lastPathComponent]; lock.unlock()
        } else if url.path.hasPrefix("/__near/") {
            // archivo vecino del documento abierto (p. ej. la imagen de la firma junto al DXF)
            let parts = url.path.dropFirst("/__near/".count).split(separator: "/", maxSplits: 1).map(String.init)
            lock.lock(); let doc = parts.count == 2 ? files[parts[0]] : nil; lock.unlock()
            if let doc = doc {
                let dir = doc.deletingLastPathComponent().standardizedFileURL
                let name = parts[1].removingPercentEncoding ?? parts[1]
                // ruta relativa al DXF (p. ej. «imagenes/firma.png» o «../Firmas/firma.png»); si no existe, el mismo
                // nombre junto al DXF. Fuera de la carpeta del DXF solo se sirven imágenes.
                let nearby = dir.appendingPathComponent((name as NSString).lastPathComponent).standardizedFileURL
                var cand = nearby
                if name.contains("/") {
                    let rel = dir.appendingPathComponent(name).standardizedFileURL
                    let ext = rel.pathExtension.lowercased()
                    if FileManager.default.fileExists(atPath: rel.path) && (rel.path.hasPrefix(dir.path) || ["png", "jpg", "jpeg"].contains(ext)) { cand = rel }
                }
                if cand.path.hasPrefix(dir.path) || cand != nearby { fileURL = cand }
                switch cand.pathExtension.lowercased() {
                case "png": mime = "image/png"
                case "jpg", "jpeg": mime = "image/jpeg"
                default: break
                }
            }
        } else {
            let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
            let candidate = webRoot.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
            if candidate.path.hasPrefix(webRoot.standardizedFileURL.path) { fileURL = candidate }
            switch candidate.pathExtension.lowercased() {
            case "html": mime = "text/html; charset=utf-8"
            case "js": mime = "text/javascript; charset=utf-8"
            case "css": mime = "text/css; charset=utf-8"
            case "png": mime = "image/png"
            case "svg": mime = "image/svg+xml"
            default: break
            }
        }
        let respond: (Data?) -> Void = { data in
            if let data = data {
                let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)",
                                                          "Cache-Control": "no-store"])!
                task.didReceive(resp)
                task.didReceive(data)
                task.didFinish()
            } else {
                task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            }
        }
        guard let f = fileURL else { respond(nil); return }
        DispatchQueue.global(qos: .userInitiated).async {
            var data: Data?
            do { data = try Data(contentsOf: f, options: .mappedIfSafe) }
            catch { NSLog("Domoplano: no se pudo leer \(f.path): \(error)") }
            DispatchQueue.main.async { respond(data) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class ViewerWindow: NSWindowController, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    let webView: WKWebView
    let handler: SchemeHandler
    private(set) var fileURL: URL?
    var onClose: ((ViewerWindow) -> Void)?
    /// Hay cambios sin guardar en el editor (lo avisa la página).
    private(set) var dirty = false
    private var backedUp = Set<String>()
    private var closeAfterSave = false
    /// JavaScript que se ejecuta cuando la página termina de cargar (p. ej. empezar un plano nuevo en una ventana nueva).
    var pendingJS: String?
    /// La interfaz (index.html) ya terminó de cargar: se le puede pedir JavaScript.
    private(set) var isLoaded = false

    init(handler: SchemeHandler) {
        self.handler = handler
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(handler, forURLScheme: kScheme)
        let ucc = WKUserContentController()
        cfg.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: cfg)
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
        let w = min(1500, screen.width * 0.85), h = min(1000, screen.height * 0.88)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "Domoplano"
        win.minSize = NSSize(width: 640, height: 420)
        win.contentView = webView
        win.backgroundColor = NSColor(calibratedRed: 0.35, green: 0.38, blue: 0.41, alpha: 1)
        win.titlebarAppearsTransparent = false
        win.isReleasedWhenClosed = false
        super.init(window: win)
        win.delegate = self
        ucc.add(WeakHandler(self), name: "native")
        webView.navigationDelegate = self
        win.center()
        win.setFrameAutosaveName("DomoplanoWindow")
    }
    required init?(coder: NSCoder) { fatalError() }

    func load(file: URL?) {
        fileURL = file
        var comps = URLComponents()
        comps.scheme = kScheme; comps.host = "app"; comps.path = "/index.html"
        if let file = file {
            let token = handler.register(file)
            comps.queryItems = [URLQueryItem(name: "file", value: "\(kScheme)://app/__file/\(token)"),
                                URLQueryItem(name: "name", value: file.lastPathComponent)]
            window?.title = file.lastPathComponent
            window?.representedURL = file
            NSDocumentController.shared.noteNewRecentDocumentURL(file)
        }
        webView.load(URLRequest(url: comps.url!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoaded = true
        if let js = pendingJS { pendingJS = nil; webView.evaluateJavaScript(js) }
    }

    /// Plano nuevo en esta ventana (no tiene archivo todavía: al guardar se pregunta el nombre).
    func startNew() {
        fileURL = nil
        window?.title = "Plano nuevo (sin guardar)"
        window?.representedURL = nil
        if isLoaded { webView.evaluateJavaScript("window.domoNuevoAqui && domoNuevoAqui()") } else { pendingJS = "window.domoNuevoAqui && domoNuevoAqui()" }
    }

    /// Plano nuevo desde la plantilla EPM en esta ventana (js = llamada a domoNuevoEPMAqui con la hoja).
    func startNewEPM(_ js: String) {
        fileURL = nil
        window?.title = "Plano EPM nuevo (sin guardar)"
        window?.representedURL = nil
        if isLoaded { webView.evaluateJavaScript(js) } else { pendingJS = js }
    }

    /// Abre otro archivo en esta misma ventana sin recargar la interfaz.
    func replace(with file: URL) {
        fileURL = file
        let token = handler.register(file)
        window?.title = file.lastPathComponent
        window?.representedURL = file
        NSDocumentController.shared.noteNewRecentDocumentURL(file)
        let js = "visorOpenURL(\(jsString("\(kScheme)://app/__file/\(token)")), \(jsString(file.lastPathComponent)))"
        webView.evaluateJavaScript(js)
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        if cmd == "opendwg" { AppDelegate.shared.panelAbrirDWG(para: fileURL == nil && !dirty ? self : nil); return }   // H6-D (mac/dwg.swift)
        if cmd == "open" {
            AppDelegate.shared.runOpenPanel(for: self)
        } else if cmd == "new" {
            AppDelegate.shared.nuevoPlano(from: self)
        } else if cmd == "newepm" {
            AppDelegate.shared.nuevoPlanoEPM(from: self, hoja: (body["hoja"] as? String) ?? "1000x707")
        } else if cmd == "dirty" {
            dirty = (body["value"] as? Bool) ?? false
            window?.isDocumentEdited = dirty
        } else if cmd == "save", let text = body["text"] as? String {
            let enc = (body["encoding"] as? String) ?? "utf-8"
            let asNew = (body["as"] as? Bool) ?? false
            save(text: text, encoding: enc, asNew: asNew)
        } else if cmd == "exportdwf", let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) {
            exportFile(data: data, name: (body["name"] as? String) ?? "Plano.dwf", ext: "dwf", kind: "DWF")
        } else if cmd == "exportpdf", let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) {
            exportFile(data: data, name: (body["name"] as? String) ?? "Plano.pdf", ext: "pdf", kind: "PDF")
        } else if cmd == "pickimage" {
            pickImage()
        } else if cmd == "copytext", let text = body["text"] as? String {
            // H6-B: CANTIDADES › Copiar para Excel y LISTA › Copiar (portapapeles del Mac)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        } else if cmd == "pickosm" {
            pickOSM()
        } else if cmd == "pickcompare" {
            pickCompare()   // H6-E: COMPARAR
        } else if cmd == "exportmd", let text = body["text"] as? String {
            exportFile(data: Data(text.utf8), name: (body["name"] as? String) ?? "Informe.md", ext: "md", kind: "Informe")   // H6-E
        }
    }

    // MARK: H6-E COMPARAR — elegir la versión anterior (DXF, o el DWF radicado o devuelto por EPM)
    func pickCompare() {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = false
        p.canChooseDirectories = false
        p.allowedContentTypes = ["dxf", "dwf", "dwfx"].compactMap { UTType(filenameExtension: $0) }
        p.message = "Elija la versión ANTERIOR del plano (DXF, o el DWF radicado o devuelto por EPM)"
        if let doc = fileURL { p.directoryURL = doc.deletingLastPathComponent() }
        p.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let f = p.url else {
                self.webView.evaluateJavaScript("window.domoCompararElegido && domoCompararElegido(null)"); return
            }
            let token = self.handler.register(f)
            let url = "\(kScheme)://app/__file/\(token)"
            self.webView.evaluateJavaScript("window.domoCompararElegido && domoCompararElegido({url: \(jsString(url)), name: \(jsString(f.lastPathComponent))})")
        }
    }

    // MARK: MAPAOSM — elegir un .osm o .json de OpenStreetMap guardado (sin internet)
    func pickOSM() {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = false
        p.canChooseDirectories = false
        p.allowedContentTypes = ["osm", "json", "xml"].compactMap { UTType(filenameExtension: $0) }
        p.message = "Elija el mapa de OpenStreetMap (.osm o .json de Overpass)"
        if let doc = fileURL { p.directoryURL = doc.deletingLastPathComponent() }
        p.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let f = p.url, let text = try? String(contentsOf: f, encoding: .utf8) else {
                self.webView.evaluateJavaScript("window.domoOSMElegido && domoOSMElegido(null)"); return
            }
            let js = "window.domoOSMElegido && domoOSMElegido({name: \(jsString(f.lastPathComponent)), text: \(jsString(text))})"
            self.webView.evaluateJavaScript(js)
        }
    }

    // MARK: IMAGEN — elegir PNG/JPG; la ruta se guarda RELATIVA a la carpeta del DXF
    func pickImage() {
        guard let doc = fileURL, doc.pathExtension.lowercased() == "dxf" else {
            webView.evaluateJavaScript("window.domoImagenElegida && domoImagenElegida({error: \(jsString("IMAGEN: primero guarde el plano (⌘S) para que la imagen quede con ruta relativa al DXF."))})")
            return
        }
        let p = NSOpenPanel()
        p.allowsMultipleSelection = false
        p.canChooseDirectories = false
        p.allowedContentTypes = [UTType.png, UTType.jpeg]
        p.message = "Elija la imagen (PNG o JPG): firma, logo…"
        p.directoryURL = doc.deletingLastPathComponent()
        p.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let img = p.url else {
                self.webView.evaluateJavaScript("window.domoImagenElegida && domoImagenElegida(null)"); return
            }
            let rel = ViewerWindow.relativePath(from: doc.deletingLastPathComponent(), to: img)
            let token = self.handler.register(img)
            let url = "\(kScheme)://app/__file/\(token)"
            let js = "window.domoImagenElegida && domoImagenElegida({url: \(jsString(url)), rel: \(jsString(rel)), name: \(jsString(img.lastPathComponent))})"
            self.webView.evaluateJavaScript(js)
        }
    }

    /// Ruta de `file` relativa a la carpeta `dir` (con «../» si hace falta). Si están en discos distintos, la absoluta.
    static func relativePath(from dir: URL, to file: URL) -> String {
        let a = dir.standardizedFileURL.resolvingSymlinksInPath().pathComponents
        let b = file.standardizedFileURL.resolvingSymlinksInPath().pathComponents
        var i = 0
        while i < a.count && i < b.count && a[i] == b[i] { i += 1 }
        if i <= 1 { return file.path }  // nada en común salvo la raíz
        let up = Array(repeating: "..", count: a.count - i)
        return (up + b[i...]).joined(separator: "/")
    }

    // MARK: exportar DWF / PDF (los escriben web/dwf_writer.js y web/pdf_writer.js; aquí solo se elige dónde guardarlo)
    func exportFile(data: Data, name: String, ext: String, kind: String) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = name
        if let dir = (dwgOrigen ?? fileURL)?.deletingLastPathComponent() { panel.directoryURL = dir }
        panel.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let url = panel.url else {
                self.webView.evaluateJavaScript("window.domoExported && domoExported(false, 'Exportación cancelada.')"); return
            }
            do {
                try data.write(to: url, options: .atomic)
                let kb = Int((Double(data.count) / 1024).rounded())
                self.webView.evaluateJavaScript("window.domoExported && domoExported(true, \(jsString("\(kind) guardado: \(url.lastPathComponent) (\(kb) KB)")))")
            } catch {
                self.webView.evaluateJavaScript("window.domoExported && domoExported(false, \(jsString("No se pudo guardar el \(kind): \(error.localizedDescription)")))")
            }
        }
    }

    // MARK: guardar DXF
    private func encode(_ text: String, _ enc: String) -> Data {
        if enc == "windows-1252" {
            if let d = text.data(using: .windowsCP1252, allowLossyConversion: false) { return d }
            // DXF anterior a 2007: los caracteres fuera de la página de códigos van como \U+XXXX
            var out = ""
            for ch in text.unicodeScalars {
                if String(ch).data(using: .windowsCP1252, allowLossyConversion: false) != nil { out.unicodeScalars.append(ch) }
                else { out += String(format: "\\U+%04X", ch.value) }
            }
            return out.data(using: .windowsCP1252, allowLossyConversion: true) ?? Data()
        }
        return text.data(using: .utf8) ?? Data()
    }

    private func reply(_ ok: Bool, _ msg: String) {
        webView.evaluateJavaScript("domoSaved(\(ok ? "true" : "false"), \(jsString(msg)))")
    }

    func save(text: String, encoding: String, asNew: Bool) {
        let data = encode(text, encoding)
        func write(to url: URL) {
            do {
                let fm = FileManager.default
                var note = ""
                // respaldo del archivo como estaba antes de la primera edición de esta sesión
                if fm.fileExists(atPath: url.path) && !backedUp.contains(url.path) {
                    let bak = url.appendingPathExtension("bak")
                    try? fm.removeItem(at: bak)
                    try fm.copyItem(at: url, to: bak)
                    backedUp.insert(url.path)
                    note = " · respaldo: \(bak.lastPathComponent)"
                }
                try data.write(to: url, options: .atomic)
                if url != fileURL {
                    fileURL = url
                    window?.title = url.lastPathComponent
                    window?.representedURL = url
                    NSDocumentController.shared.noteNewRecentDocumentURL(url)
                }
                reply(true, "Guardado: \(url.lastPathComponent)\(note)")
                if closeAfterSave { closeAfterSave = false; dirty = false; window?.close() }
            } catch {
                closeAfterSave = false
                reply(false, "No se pudo guardar: \(error.localizedDescription)")
            }
        }
        if !asNew, !esDXFTemporal, let url = fileURL, url.pathExtension.lowercased() == "dxf" { write(to: url); return }   // H6-D: el DXF temporal de un DWG pide dónde guardar
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "dxf") ?? .data]
        panel.canCreateDirectories = true
        let base = fileURL?.deletingPathExtension().lastPathComponent ?? "Plano"
        panel.nameFieldStringValue = base + ".dxf"
        if let dir = (dwgOrigen ?? fileURL)?.deletingLastPathComponent() { panel.directoryURL = dir }
        panel.beginSheetModal(for: window!) { resp in
            if resp == .OK, let url = panel.url { write(to: url) }
            else { self.closeAfterSave = false; self.reply(false, "Guardado cancelado.") }
        }
    }

    // MARK: F4 — guardar desde el MCP «domoplano» (ruta dada; sin panel). Mismo respaldo .bak que al guardar a mano.
    func saveForMCP(text: String, encoding: String, path: String?) -> [String: Any] {
        let url: URL
        if let p = path, !p.isEmpty { url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath) }
        else if let f = fileURL, !esDXFTemporal, f.pathExtension.lowercased() == "dxf" { url = f }
        else { return ["error": "Este plano no tiene archivo DXF todavía: dé la ruta donde guardarlo."] }
        guard url.pathExtension.lowercased() == "dxf" else { return ["error": "Solo se guarda en DXF (.dxf)."] }
        let data = encode(text, encoding)
        do {
            let fm = FileManager.default
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var note = ""
            if fm.fileExists(atPath: url.path) && !backedUp.contains(url.path) {
                let bak = url.appendingPathExtension("bak")
                try? fm.removeItem(at: bak)
                try fm.copyItem(at: url, to: bak)
                backedUp.insert(url.path)
                note = " · respaldo: \(bak.lastPathComponent)"
            }
            try data.write(to: url, options: .atomic)
            if url != fileURL {
                fileURL = url
                // el plano queda registrado con su archivo (las imágenes vecinas se siguen sirviendo junto al DXF)
                window?.title = url.lastPathComponent
                window?.representedURL = url
            }
            reply(true, "Guardado por Claude: \(url.lastPathComponent)\(note)")
            return ["ok": true, "ruta": url.path, "bytes": data.count, "nota": note]
        } catch {
            return ["error": "No se pudo guardar: \(error.localizedDescription)"]
        }
    }

    /// F4 — captura SOLO de esta ventana de Domoplano (lo que muestra el dibujo), en PNG.
    func snapshotPNG(_ done: @escaping (Data?) -> Void) {
        let cfg = WKSnapshotConfiguration()
        webView.takeSnapshot(with: cfg) { img, _ in
            guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { done(nil); return }
            done(rep.representation(using: .png, properties: [:]))
        }
    }

    @objc func saveDocument(_ sender: Any?) { webView.evaluateJavaScript("window.domoSave && domoSave()") }
    @objc func exportDWFMenu(_ sender: Any?) { webView.evaluateJavaScript("CAD.enabled() ? CAD.start('EXPORTARDWF') : null") }
    @objc func exportPDFMenu(_ sender: Any?) { webView.evaluateJavaScript("CAD.enabled() ? CAD.start('EXPORTARPDF') : null") }
    @objc func imagenMenu(_ sender: Any?) { webView.evaluateJavaScript("CAD.enabled() ? CAD.start('IMAGEN') : null") }
    @objc func grosoresMenu(_ sender: Any?) { webView.evaluateJavaScript("window.domoLwDisplay && domoLwDisplay()") }
    @objc func saveDocumentAs(_ sender: Any?) { webView.evaluateJavaScript("window.domoSaveAs && domoSaveAs()") }
    @objc func undoEdit(_ sender: Any?) { webView.evaluateJavaScript("CAD.enabled() && CAD.start('DESHACER')") }
    @objc func redoEdit(_ sender: Any?) { webView.evaluateJavaScript("CAD.enabled() && CAD.start('REHACER')") }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard dirty else { return true }
        let a = NSAlert()
        a.messageText = "¿Guardar los cambios de \(fileURL?.lastPathComponent ?? "este plano")?"
        a.informativeText = "Si no los guarda, se pierden."
        a.addButton(withTitle: "Guardar")
        a.addButton(withTitle: "No guardar")
        a.addButton(withTitle: "Cancelar")
        a.beginSheetModal(for: sender) { r in
            if r == .alertFirstButtonReturn { self.closeAfterSave = true; self.saveDocument(nil) }
            else if r == .alertSecondButtonReturn { self.dirty = false; sender.close() }
        }
        return false
    }

    func windowWillClose(_ notification: Notification) { onClose?(self) }
}

/// Evita el ciclo de retención entre WKUserContentController y la ventana.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(u, didReceive: m)
    }
}

func jsString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    let arr = String(data: data, encoding: .utf8)!
    return String(arr.dropFirst().dropLast())
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate!
    var windows: [ViewerWindow] = []
    lazy var handler: SchemeHandler = {
        let root = Bundle.main.resourceURL!.appendingPathComponent("web")
        return SchemeHandler(webRoot: root)
    }()
    private var openedAtLaunch = false
    /// Abierta por el MCP con «open -g … --args --mcp»: la primera ventana no toma el foco.
    var sinFoco = CommandLine.arguments.contains("--mcp")
    /// Ventana sobre la que trabaja Claude (la última que abrió o creó por el MCP).
    weak var mcpWindow: ViewerWindow?
    var canal: CanalMCP?

    func applicationWillFinishLaunching(_ n: Notification) {
        AppDelegate.shared = self
        buildMenu()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if self.windows.isEmpty && !self.openedAtLaunch { self.newWindow(file: nil) }
            self.sinFoco = false
        }
        canal = CanalMCP(app: self)
        canal?.start()
    }

    func applicationWillTerminate(_ n: Notification) { canal?.stop() }

    func application(_ app: NSApplication, open urls: [URL]) {
        openedAtLaunch = true
        for u in urls { open(file: u) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let pend = windows.filter { $0.dirty }
        guard !pend.isEmpty else { return .terminateNow }
        let a = NSAlert()
        a.messageText = pend.count == 1 ? "Hay un plano con cambios sin guardar." : "Hay \(pend.count) planos con cambios sin guardar."
        a.informativeText = "Si sale ahora, se pierden esos cambios."
        a.addButton(withTitle: "Cancelar")
        a.addButton(withTitle: "Salir sin guardar")
        return a.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { newWindow(file: nil) }
        return true
    }

    func open(file: URL) {
        if file.pathExtension.lowercased() == "dwg" { abrirDWG(file); return }   // H6-D: DWG → DXF con LibreDWG (mac/dwg.swift)
        // Si ya está abierto, traerlo al frente
        if let w = windows.first(where: { $0.fileURL?.standardizedFileURL == file.standardizedFileURL }) {
            w.window?.makeKeyAndOrderFront(nil); return
        }
        // Reutilizar una ventana vacía
        if let w = windows.first(where: { $0.fileURL == nil }) {
            w.replace(with: file); w.window?.makeKeyAndOrderFront(nil); return
        }
        newWindow(file: file)
    }

    @discardableResult
    func newWindow(file: URL?, activate: Bool = true) -> ViewerWindow {
        let w = ViewerWindow(handler: handler)
        w.onClose = { [weak self] closed in self?.windows.removeAll { $0 === closed } }
        if let last = windows.last?.window {
            w.window?.setFrameTopLeftPoint(NSPoint(x: last.frame.minX + 26, y: last.frame.maxY - 26))
        }
        windows.append(w)
        w.load(file: file)
        if activate && !sinFoco {
            w.showWindow(nil)
            w.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        } else {
            w.window?.orderFront(nil)   // abierta por Claude (MCP): se ve, pero no le quita el teclado a Sebastián
        }
        return w
    }

    func runOpenPanel(for target: ViewerWindow?) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = true
        p.canChooseDirectories = false
        p.allowedContentTypes = ["dxf", "dwf", "dwfx", "dwg"].compactMap { UTType(filenameExtension: $0) }
        p.message = "Elige planos DXF, DWF, DWFx o DWG (el DWG se convierte a DXF con LibreDWG)"
        p.begin { resp in
            guard resp == .OK else { return }
            for (i, u) in p.urls.enumerated() {
                if u.pathExtension.lowercased() == "dwg" { self.abrirDWG(u, en: i == 0 ? target : nil) }
                else if i == 0, let t = target { t.replace(with: u) } else { self.open(file: u) }
            }
        }
    }

    @objc func openDocument(_ sender: Any?) {
        let key = windows.first { $0.window?.isKeyWindow == true }
        runOpenPanel(for: key?.fileURL == nil ? key : nil)
    }

    @objc func newDocumentWindow(_ sender: Any?) { newWindow(file: nil) }

    /// NUEVO: si la ventana está vacía (sin archivo y sin cambios) se usa; si no, se abre otra ventana con el plano en blanco.
    func nuevoPlano(from w: ViewerWindow?) {
        if let w = w, w.fileURL == nil, !w.dirty { w.startNew(); w.window?.makeKeyAndOrderFront(nil); return }
        let nw = newWindow(file: nil)
        nw.pendingJS = "window.domoNuevoAqui && domoNuevoAqui()"
        nw.window?.title = "Plano nuevo (sin guardar)"
    }
    @objc func newPlanoMenu(_ sender: Any?) { nuevoPlano(from: windows.first { $0.window?.isKeyWindow == true }) }
    /// Plano nuevo desde la plantilla EPM propia (hoja 1000×707, A0, A1 o A2).
    func nuevoPlanoEPM(from w: ViewerWindow?, hoja: String) {
        let js = "window.domoNuevoEPMAqui && domoNuevoEPMAqui(\(jsString(hoja)))"
        if let w = w, w.fileURL == nil, !w.dirty {
            w.startNewEPM(js); w.window?.makeKeyAndOrderFront(nil); return
        }
        let nw = newWindow(file: nil)
        nw.pendingJS = js
        nw.window?.title = "Plano EPM nuevo (sin guardar)"
    }
    @objc func newPlanoEPMMenu(_ sender: Any?) {
        let a = NSAlert()
        a.messageText = "Nuevo plano EPM"
        a.informativeText = "Plantilla propia de Domoplano según NC-RA8-001 (rótulo, sello, convenciones y ventanas 1:500 y 1:1000). Elija la hoja:"
        for t in ["1000 × 707 (EPM)", "A0", "A1", "A2", "Cancelar"] { a.addButton(withTitle: t) }
        let r = a.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        let hojas = ["1000x707", "A0", "A1", "A2"]
        guard r >= 0 && r < hojas.count else { return }
        nuevoPlanoEPM(from: windows.first { $0.window?.isKeyWindow == true }, hoja: hojas[r])
    }

    @objc func reloadWeb(_ sender: Any?) {
        if let w = windows.first(where: { $0.window?.isKeyWindow == true }) { w.load(file: w.fileURL) }
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Acerca de Domoplano", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ocultar Domoplano", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Salir de Domoplano", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let fileMenu = NSMenu(title: "Archivo")
        fileMenu.addItem(withTitle: "Nuevo plano", action: #selector(newPlanoMenu(_:)), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Nuevo plano EPM…", action: #selector(newPlanoEPMMenu(_:)), keyEquivalent: "")
        let nwin = fileMenu.addItem(withTitle: "Nueva ventana", action: #selector(newDocumentWindow(_:)), keyEquivalent: "n")
        nwin.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Abrir…", action: #selector(openDocument(_:)), keyEquivalent: "o")
        fileMenu.addItem(withTitle: "Abrir DWG…", action: #selector(abrirDWGMenu(_:)), keyEquivalent: "")   // H6-D
        let recent = NSMenuItem(title: "Abrir recientes", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Abrir recientes")
        recentMenu.perform(NSSelectorFromString("_setMenuName:"), with: "NSRecentDocumentsMenu")
        recentMenu.addItem(withTitle: "Borrar menú", action: #selector(NSDocumentController.clearRecentDocuments(_:)), keyEquivalent: "")
        recent.submenu = recentMenu
        fileMenu.addItem(recent)
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Guardar", action: #selector(ViewerWindow.saveDocument(_:)), keyEquivalent: "s")
        let saveAs = fileMenu.addItem(withTitle: "Guardar como…", action: #selector(ViewerWindow.saveDocumentAs(_:)), keyEquivalent: "s")
        saveAs.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Exportar DWF para EPM…", action: #selector(ViewerWindow.exportDWFMenu(_:)), keyEquivalent: "e")
        // ⌘P = Exportar PDF (como Imprimir/TRAZAR); no choca con nada de la app
        fileMenu.addItem(withTitle: "Exportar PDF…", action: #selector(ViewerWindow.exportPDFMenu(_:)), keyEquivalent: "p")
        let img = fileMenu.addItem(withTitle: "Insertar imagen (firma)…", action: #selector(ViewerWindow.imagenMenu(_:)), keyEquivalent: "i")
        img.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let editMenu = NSMenu(title: "Edición")
        editMenu.addItem(withTitle: "Deshacer", action: #selector(ViewerWindow.undoEdit(_:)), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Rehacer", action: #selector(ViewerWindow.redoEdit(_:)), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let viewMenu = NSMenu(title: "Visualización")
        viewMenu.addItem(withTitle: "Recargar", action: #selector(reloadWeb(_:)), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Mostrar/ocultar grosores de línea", action: #selector(ViewerWindow.grosoresMenu(_:)), keyEquivalent: "l")
        let fs = viewMenu.addItem(withTitle: "Pantalla completa", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu

        let winItem = NSMenuItem(); main.addItem(winItem)
        let winMenu = NSMenu(title: "Ventana")
        winMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winItem.submenu = winMenu
        NSApp.windowsMenu = winMenu
        NSApp.mainMenu = main
    }
}

// MARK: - F4 · Canal local para el MCP «domoplano» (Claude trabaja por dentro, sin teclado ni ratón)
// Socket Unix en ~/Library/Application Support/Domoplano/mcp.sock (carpeta 0700, socket 0600): NO abre puertos de red y
// solo atiende procesos del MISMO usuario (se comprueba con getpeereid). Una petición = una línea JSON; una respuesta = una línea.
//   {"op":"ventanas"}                                       → ventanas abiertas (archivo, título, cambios sin guardar)
//   {"op":"js","fn":"info","args":{…},"ventana":0}          → DomoMCP.app(fn, args) en la página de la ventana
//   {"op":"abrir","ruta":"/…/plano.dxf"}                    → abre el plano en una ventana (sin quitar el foco)
//   {"op":"nuevo","plantilla":"epm"|"blanco","hoja":"A1"}   → plano nuevo
//   {"op":"guardar","texto":"…","codificacion":"utf-8","ruta":"/…/x.dxf"}
//   {"op":"captura","ventana":0}                            → PNG (base64) de la ventana de Domoplano solamente
final class CanalMCP {
    weak var app: AppDelegate?
    let path: String
    private var fd: Int32 = -1
    private var running = false

    init(app: AppDelegate) {
        self.app = app
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Domoplano")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        chmod(dir.path, 0o700)
        path = dir.appendingPathComponent("mcp.sock").path
    }

    func start() {
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { NSLog("Domoplano MCP: no se pudo crear el socket"); return }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { close(fd); fd = -1; return }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in for (i, b) in bytes.enumerated() { raw[i] = b }; raw[bytes.count] = 0 }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) } }
        guard ok == 0 else { NSLog("Domoplano MCP: bind falló (\(errno))"); close(fd); fd = -1; return }
        chmod(path, 0o600)
        guard listen(fd, 4) == 0 else { close(fd); fd = -1; return }
        running = true
        let lfd = fd
        Thread.detachNewThread { [weak self] in
            while let s = self, s.running {
                let c = accept(lfd, nil, nil)
                if c < 0 { if s.running { continue } else { break } }
                // solo el mismo usuario del Mac
                var uid: uid_t = 0, gid: gid_t = 0
                if getpeereid(c, &uid, &gid) != 0 || uid != getuid() { close(c); continue }
                Thread.detachNewThread { s.serve(c) }
            }
        }
    }

    func stop() { running = false; if fd >= 0 { close(fd); fd = -1 }; unlink(path) }

    private func serve(_ c: Int32) {
        var buf = Data()
        var chunk = [UInt8](repeating: 0, count: 65536)
        defer { close(c) }
        while true {
            let n = read(c, &chunk, chunk.count)
            if n <= 0 { return }
            buf.append(chunk, count: n)
            while let nl = buf.firstIndex(of: 10) {
                let line = buf.subdata(in: buf.startIndex..<nl)
                buf.removeSubrange(buf.startIndex...nl)
                let resp = handle(line)
                var out = (try? JSONSerialization.data(withJSONObject: resp)) ?? Data("{\"error\":\"respuesta inválida\"}".utf8)
                out.append(10)
                out.withUnsafeBytes { p in
                    var off = 0
                    while off < out.count { let w = write(c, p.baseAddress! + off, out.count - off); if w <= 0 { return }; off += w }
                }
            }
        }
    }

    /// Atiende una petición (corre en un hilo aparte; lo de la ventana se hace en el hilo principal).
    private func handle(_ line: Data) -> [String: Any] {
        guard let req = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], let op = req["op"] as? String else {
            return ["error": "Petición inválida."]
        }
        let sem = DispatchSemaphore(value: 0)
        var result: [String: Any] = ["error": "Sin respuesta de Domoplano."]
        let finish: ([String: Any]) -> Void = { r in result = r; sem.signal() }
        DispatchQueue.main.async { self.dispatch(op, req, finish) }
        let timeout = (req["espera"] as? Double) ?? 300
        if sem.wait(timeout: .now() + timeout) == .timedOut { return ["error": "Domoplano no respondió a tiempo (\(Int(timeout)) s)."] }
        return result
    }

    private func target(_ req: [String: Any]) -> ViewerWindow? {
        guard let app = app else { return nil }
        if let i = req["ventana"] as? Int, i >= 0, i < app.windows.count { return app.windows[i] }
        if let r = req["archivo"] as? String {
            let u = URL(fileURLWithPath: (r as NSString).expandingTildeInPath).standardizedFileURL
            if let w = app.windows.first(where: { $0.fileURL?.standardizedFileURL == u }) { return w }
        }
        if let w = app.mcpWindow, app.windows.contains(where: { $0 === w }) { return w }
        return app.windows.first(where: { $0.window?.isKeyWindow == true }) ?? app.windows.last
    }

    private func dispatch(_ op: String, _ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        guard let app = app else { done(["error": "La app se está cerrando."]); return }
        switch op {
        case "ventanas":
            let cur = target(req)
            done(["ok": true, "app": "Domoplano", "pid": Int(getpid()), "ventanas": app.windows.enumerated().map { (i, w) in
                ["indice": i, "archivo": w.fileURL?.path ?? NSNull(), "titulo": w.window?.title ?? "", "sin_guardar": w.dirty,
                 "activa": w.window?.isKeyWindow == true, "de_claude": w === cur] as [String: Any] }])
        case "js":
            guard let w = target(req) else { done(["error": "Domoplano no tiene ventanas abiertas."]); return }
            let fn = (req["fn"] as? String) ?? "info"
            let argsData = (try? JSONSerialization.data(withJSONObject: req["args"] ?? [:])) ?? Data("{}".utf8)
            let args = String(data: argsData, encoding: .utf8) ?? "{}"
            w.webView.callAsyncJavaScript("return await DomoMCP.app(fn, JSON.parse(args));", arguments: ["fn": fn, "args": args], in: nil, in: .page) { r in
                switch r {
                case .success(let v):
                    if let s = v as? String, let d = s.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { done(o) }
                    else { done(["error": "Respuesta inesperada de la página."]) }
                case .failure(let e): done(["error": "La página de Domoplano no respondió: \(e.localizedDescription)"])
                }
            }
        case "abrir":
            guard let r = req["ruta"] as? String else { done(["error": "Falta la ruta."]); return }
            let u = URL(fileURLWithPath: (r as NSString).expandingTildeInPath)
            guard FileManager.default.fileExists(atPath: u.path) else { done(["error": "No existe: \(u.path)"]); return }
            if let w = app.windows.first(where: { $0.fileURL?.standardizedFileURL == u.standardizedFileURL }) {
                app.mcpWindow = w; done(["ok": true, "ya_abierto": true, "indice": app.windows.firstIndex { $0 === w } ?? -1]); return
            }
            let w: ViewerWindow
            if let e = app.windows.first(where: { $0.fileURL == nil && !$0.dirty }) { if e.isLoaded { e.replace(with: u) } else { e.load(file: u) }; w = e }
            else { w = app.newWindow(file: u, activate: false) }
            app.mcpWindow = w
            done(["ok": true, "indice": app.windows.firstIndex { $0 === w } ?? -1])
        case "nuevo":
            let epm = ((req["plantilla"] as? String) ?? "blanco").lowercased() == "epm"
            let hoja = (req["hoja"] as? String) ?? "1000x707"
            let js = epm ? "window.domoNuevoEPMAqui && domoNuevoEPMAqui(\(jsString(hoja)))" : "window.domoNuevoAqui && domoNuevoAqui()"
            let w: ViewerWindow
            if let e = app.windows.first(where: { $0.fileURL == nil && !$0.dirty }) {
                w = e
                if epm { e.startNewEPM(js) } else { e.startNew() }
            } else {
                w = app.newWindow(file: nil, activate: false)
                w.pendingJS = js
                w.window?.title = epm ? "Plano EPM nuevo (sin guardar)" : "Plano nuevo (sin guardar)"
            }
            app.mcpWindow = w
            done(["ok": true, "indice": app.windows.firstIndex { $0 === w } ?? -1])
        case "guardar":
            guard let w = target(req) else { done(["error": "Domoplano no tiene ventanas abiertas."]); return }
            guard let text = req["texto"] as? String else { done(["error": "Falta el texto del DXF."]); return }
            done(w.saveForMCP(text: text, encoding: (req["codificacion"] as? String) ?? "utf-8", path: req["ruta"] as? String))
        case "captura":
            guard let w = target(req) else { done(["error": "Domoplano no tiene ventanas abiertas."]); return }
            w.snapshotPNG { png in
                if let png = png { done(["ok": true, "png": png.base64EncodedString(), "titulo": w.window?.title ?? ""]) }
                else { done(["error": "No se pudo capturar la ventana."]) }
            }
        default:
            done(["error": "Operación desconocida: \(op)"])
        }
    }
}

// --- Arranque ---
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
