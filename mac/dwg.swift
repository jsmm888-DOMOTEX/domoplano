// Domoplano — H6-D: abrir DWG de terceros SIN AutoCAD.
// Convierte el .dwg a un DXF temporal con LibreDWG (dwg2dxf, GNU, GPLv3) ejecutado como PROGRAMA APARTE
// (no se enlaza código GPL dentro de Domoplano; uso interno DOMOTEX) y abre ese DXF. El .dwg original no se toca:
// al guardar (⌘S) se pide dónde guardar el .dxf (por omisión, junto al original, con el mismo nombre).
import Cocoa
import UniformTypeIdentifiers

enum LibreDWG {
    /// dwg2dxf / dxf2dwg / dwgread: dentro de la app (Resources/libredwg) o en vendor/ del proyecto.
    static func binario(_ nombre: String) -> URL? {
        var cand: [URL] = []
        if let r = Bundle.main.resourceURL { cand.append(r.appendingPathComponent("libredwg/\(nombre)")) }
        cand.append(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents/Programas/Domoplano/vendor/libredwg/instalado/bin/\(nombre)"))
        return cand.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// Carpeta de los DXF temporales (se borra al salir de la app).
    static let carpeta = FileManager.default.temporaryDirectory.appendingPathComponent("Domoplano-DWG", isDirectory: true)

    static let versiones = ["AC1009": "R11/R12", "AC1012": "R13", "AC1014": "R14", "AC1015": "AutoCAD 2000",
                            "AC1018": "AutoCAD 2004", "AC1021": "AutoCAD 2007", "AC1024": "AutoCAD 2010",
                            "AC1027": "AutoCAD 2013", "AC1032": "AutoCAD 2018–2026"]

    struct Informe {
        let dwg: URL, dxf: URL
        let version: String, segundos: Double
        let entidades: Int, avisos: Int, errores: Int
        let ole: Int, proxy: Int, dinamicos: Bool, xref: [String], shx: [String]

        /// Diccionario para la interfaz (web/dwg.js arma el aviso).
        var js: [String: Any] {
            ["dwg": dwg.lastPathComponent, "ruta": dwg.path, "version": version, "segundos": segundos, "entidades": entidades,
             "avisos": avisos, "errores": errores, "ole": ole, "proxy": proxy, "dinamicos": dinamicos, "xref": xref, "shx": shx]
        }
    }

    enum Falla: LocalizedError {
        case sinPrograma, noEsDWG(String), conversion(String)
        var errorDescription: String? {
            switch self {
            case .sinPrograma: return "No encuentro LibreDWG (dwg2dxf). Compílelo en ~/Documents/Programas/Domoplano/vendor/libredwg/ o reinstale la app con mac/build.sh."
            case .noEsDWG(let c): return "El archivo no parece un DWG (cabecera «\(c)»)."
            case .conversion(let m): return "LibreDWG no pudo convertir el DWG: \(m)"
            }
        }
    }

    static func cabecera(_ url: URL) -> String {
        guard let h = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? h.close() }
        return String(data: h.readData(ofLength: 6), encoding: .isoLatin1) ?? ""
    }

    /// Convierte en segundo plano y responde en el hilo principal.
    static func convertir(_ dwg: URL, listo: @escaping (Result<Informe, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let r: Result<Informe, Error>
            do { r = .success(try convertirYa(dwg)) } catch { r = .failure(error) }
            DispatchQueue.main.async { listo(r) }
        }
    }

    static func convertirYa(_ dwg: URL) throws -> Informe {
        guard let exe = binario("dwg2dxf") else { throw Falla.sinPrograma }
        let cab = cabecera(dwg)
        guard cab.hasPrefix("AC"), cab.count == 6 else { throw Falla.noEsDWG(cab) }
        let dir = carpeta.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dxf = dir.appendingPathComponent(dwg.deletingPathExtension().lastPathComponent + ".dxf")
        let p = Process()
        p.executableURL = exe
        p.arguments = ["-y", "-o", dxf.path, dwg.path]
        let err = Pipe(); p.standardError = err; p.standardOutput = FileHandle.nullDevice
        let t0 = Date()
        try p.run()
        let limite = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 300, execute: limite)
        let datos = err.fileHandleForReading.readDataToEndOfFile()   // se lee antes de esperar (evita bloqueo con muchos avisos)
        p.waitUntilExit(); limite.cancel()
        let seg = Date().timeIntervalSince(t0)
        let stderr = String(data: datos, encoding: .utf8) ?? String(decoding: datos, as: UTF8.self)
        let lineas = stderr.split(separator: "\n")
        let avisos = lineas.filter { $0.hasPrefix("Warning") || $0.hasPrefix("ERROR") }.count
        let errores = lineas.filter { $0.hasPrefix("ERROR") }.count
        let tam = (try? FileManager.default.attributesOfItem(atPath: dxf.path)[.size] as? Int) ?? 0
        guard tam > 100, let texto = try? String(contentsOf: dxf, encoding: .isoLatin1) else {
            let ult = lineas.filter { $0.hasPrefix("ERROR") }.suffix(2).joined(separator: " · ")
            throw Falla.conversion(p.terminationReason == .uncaughtSignal ? "se detuvo (más de 5 minutos o falla interna)." : (ult.isEmpty ? "código \(p.terminationStatus)" : ult))
        }
        // recorrido rápido del DXF: entidades, OLE, proxy, bloques dinámicos, xref y fuentes SHX
        var ent = 0, ole = 0, proxy = 0, din = false
        var xref: [String] = [], shx = Set<String>()
        var sec = ""
        let L = texto.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let noCuenta: Set<String> = ["BLOCK", "ENDBLK", "SEQEND", "VERTEX", "ATTRIB", "ENDSEC", "SECTION", "EOF"]
        var i = 0
        while i + 1 < L.count {
            let c = L[i], v = L[i + 1]
            if c == "0" {
                if v == "SECTION", i + 3 < L.count { sec = L[i + 3] }
                else if v == "ENDSEC" { sec = "" }
                else if sec == "ENTITIES" || sec == "BLOCKS" {
                    if !noCuenta.contains(v) { ent += 1 }
                    if v == "OLE2FRAME" || v == "OLEFRAME" { ole += 1 }
                    if v == "ACAD_PROXY_ENTITY" { proxy += 1 }
                    if v == "BLOCK" && sec == "BLOCKS" {
                        var j = i + 2, nom = "", fl = 0, ruta = ""
                        while j + 1 < L.count && L[j] != "0" {
                            if L[j] == "2" { nom = L[j + 1] } else if L[j] == "70" { fl = Int(L[j + 1]) ?? 0 } else if L[j] == "1" { ruta = L[j + 1] }
                            j += 2
                        }
                        if fl & 4 != 0 { xref.append(ruta.isEmpty ? nom : ruta) }
                    }
                } else if sec == "OBJECTS" {
                    if v == "ACAD_PROXY_OBJECT" { proxy += 1 }
                    if v == "ACAD_EVALUATION_GRAPH" { din = true }
                }
            } else if (c == "3" || c == "1000"), v.lowercased().hasSuffix(".shx") { shx.insert(v.lowercased()) }
            else if c == "1001", v == "AcDbDynamicBlockGUID" || v == "AcDbBlockRepBTag" { din = true }
            i += 2
        }
        return Informe(dwg: dwg, dxf: dxf, version: "\(cab) (\(versiones[cab] ?? "versión desconocida"))", segundos: seg,
                       entidades: ent, avisos: avisos, errores: errores, ole: ole, proxy: proxy, dinamicos: din,
                       xref: xref, shx: shx.sorted())
    }

    static func limpiar() { try? FileManager.default.removeItem(at: carpeta) }

    /// Al salir de la app se borran los DXF temporales (se registra una sola vez, con el primer DWG).
    static var limpiezaRegistrada = false
    static func registrarLimpieza() {
        guard !limpiezaRegistrada else { return }
        limpiezaRegistrada = true
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in limpiar() }
    }
}

// MARK: - integración con la app (lo llaman los ganchos de main.swift)

/// DWG de origen de cada ventana abierta desde un .dwg (la ventana muestra el DXF temporal).
var dwgOrigenDe: [ObjectIdentifier: URL] = [:]

extension ViewerWindow {
    /// Si esta ventana muestra un DWG importado: el .dwg original.
    var dwgOrigen: URL? {
        get { dwgOrigenDe[ObjectIdentifier(self)] }
        set { dwgOrigenDe[ObjectIdentifier(self)] = newValue }
    }
    /// ¿El archivo actual es el DXF temporal de un DWG? (entonces ⌘S no escribe ahí: pregunta dónde guardar).
    var esDXFTemporal: Bool {
        guard let f = fileURL else { return false }
        return f.standardizedFileURL.path.hasPrefix(LibreDWG.carpeta.standardizedFileURL.path)
    }
}

extension AppDelegate {
    /// Abre un .dwg: convierte en segundo plano y abre el DXF temporal (en `destino` o en una ventana nueva/vacía).
    func abrirDWG(_ dwg: URL, en destino: ViewerWindow? = nil) {
        if let w = windows.first(where: { $0.dwgOrigen?.standardizedFileURL == dwg.standardizedFileURL }) {
            w.window?.makeKeyAndOrderFront(nil); return
        }
        let w = destino ?? windows.first(where: { $0.fileURL == nil && !$0.dirty }) ?? newWindow(file: nil)
        w.window?.title = "\(dwg.lastPathComponent) — convirtiendo a DXF…"
        w.window?.makeKeyAndOrderFront(nil)
        let espera = "window.domoDWGConvirtiendo && domoDWGConvirtiendo(\(jsString(dwg.lastPathComponent)))"
        if w.isLoaded { w.webView.evaluateJavaScript(espera) } else { w.pendingJS = espera }
        NSDocumentController.shared.noteNewRecentDocumentURL(dwg)
        LibreDWG.registrarLimpieza()
        LibreDWG.convertir(dwg) { r in
            switch r {
            case .success(let inf):
                w.dwgOrigen = dwg
                let datos = (try? JSONSerialization.data(withJSONObject: inf.js)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                let aviso = "window.domoDWGImportado && domoDWGImportado(\(datos))"
                if w.isLoaded {
                    w.replace(with: inf.dxf)
                    w.webView.evaluateJavaScript("setTimeout(() => { \(aviso) }, 50)")
                } else {
                    w.pendingJS = nil
                    w.load(file: inf.dxf)
                    w.pendingJS = aviso
                }
                w.window?.title = "\(dwg.lastPathComponent) (importado a DXF)"
                w.window?.representedURL = dwg
            case .failure(let e):
                w.window?.title = "Domoplano"
                let js = "window.domoDWGError && domoDWGError(\(jsString(dwg.lastPathComponent)), \(jsString(e.localizedDescription)))"
                if w.isLoaded { w.webView.evaluateJavaScript(js) } else { w.pendingJS = js }
            }
        }
    }

    /// Menú Archivo → «Abrir DWG…» y comando ABRIRDWG.
    func panelAbrirDWG(para destino: ViewerWindow?) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = true
        p.canChooseDirectories = false
        p.allowedContentTypes = [UTType(filenameExtension: "dwg") ?? .data]
        p.message = "Elija planos DWG (se convierten a DXF con LibreDWG; el .dwg no se modifica)"
        p.begin { resp in
            guard resp == .OK else { return }
            for (i, u) in p.urls.enumerated() { self.abrirDWG(u, en: i == 0 ? destino : nil) }
        }
    }

    @objc func abrirDWGMenu(_ sender: Any?) {
        let key = windows.first { $0.window?.isKeyWindow == true }
        panelAbrirDWG(para: key.flatMap { $0.fileURL == nil && !$0.dirty ? $0 : nil })
    }
}
