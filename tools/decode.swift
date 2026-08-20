import Foundation
import Vision
import AppKit
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
let req = VNDetectBarcodesRequest()
try VNImageRequestHandler(cgImage: cg).perform([req])
let results = (req.results ?? []).compactMap { $0.payloadStringValue }
if results.isEmpty { print("NO_DECODE"); exit(1) }
for r in results { print(r) }
