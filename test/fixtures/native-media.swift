import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers
import AVFoundation
import CoreVideo

func require(_ ok: Bool, _ message: String) {
  if !ok { fputs("FAILED: " + message + "\n", stderr); exit(1) }
}
let phase = CommandLine.arguments[1]
let label = CommandLine.arguments[2]
if phase == "imports" {
  print("PASS imports")
} else if phase == "png" {
  let output = URL(fileURLWithPath: "probe-" + label + ".png")
  let context = CGContext(data: nil, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 256,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.setFillColor(CGColor(red: 0.2, green: 0.7, blue: 0.4, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
  let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, context.makeImage()!, nil)
  require(CGImageDestinationFinalize(destination), "PNG finalize")
  let input = CGImageSourceCreateWithURL(output as CFURL, nil)!
  let image = CGImageSourceCreateImageAtIndex(input, 0, nil)!
  require(image.width == 64 && image.height == 64, "PNG readback dimensions")
  print("PASS png")
} else {
  let output = URL(fileURLWithPath: "probe-" + label + ".mp4")
  let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
  let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 64, AVVideoHeightKey: 64]
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: 64, kCVPixelBufferHeightKey as String: 64])
  require(writer.canAdd(input), "writer input")
  writer.add(input)
  require(writer.startWriting(), "startWriting")
  writer.startSession(atSourceTime: .zero)
  for index in 0..<2 {
    let deadline = Date().addingTimeInterval(10)
    while !input.isReadyForMoreMediaData && Date() < deadline { usleep(1000) }
    require(input.isReadyForMoreMediaData, "writer ready")
    var pixel: CVPixelBuffer?
    require(CVPixelBufferCreate(kCFAllocatorDefault, 64, 64, kCVPixelFormatType_32ARGB, nil, &pixel) == kCVReturnSuccess, "pixel allocation")
    CVPixelBufferLockBaseAddress(pixel!, [])
    let bytes = CVPixelBufferGetBaseAddress(pixel!)!.assumingMemoryBound(to: UInt8.self)
    let stride = CVPixelBufferGetBytesPerRow(pixel!)
    for y in 0..<64 {
      for x in 0..<64 {
        let offset = y * stride + x * 4
        bytes[offset] = 255; bytes[offset + 1] = index == 0 ? 220 : 20
        bytes[offset + 2] = 100; bytes[offset + 3] = index == 0 ? 20 : 220
      }
    }
    CVPixelBufferUnlockBaseAddress(pixel!, [])
    require(adaptor.append(pixel!, withPresentationTime: CMTime(value: Int64(index), timescale: 24)), "append frame")
  }
  writer.endSession(atSourceTime: CMTime(value: 2, timescale: 24))
  input.markAsFinished()
  let finished = DispatchSemaphore(value: 0)
  writer.finishWriting { finished.signal() }
  require(finished.wait(timeout: .now() + 15) == .success, "finishWriting timeout")
  require(writer.status == .completed, "writer finalize")
  let asset = AVURLAsset(url: output)
  let tracks = asset.tracks(withMediaType: .video)
  require(tracks.count == 1, "one video track")
  require(abs(asset.duration.seconds - 2.0 / 24.0) < 0.01, "two frame duration")
  let track = tracks[0]
  require(Int(track.naturalSize.width) == 64 && Int(track.naturalSize.height) == 64, "track dimensions")
  let description = track.formatDescriptions[0] as! CMFormatDescription
  require(CMFormatDescriptionGetMediaSubType(description) == kCMVideoCodecType_H264, "H264 codec")
  let reader = try AVAssetReader(asset: asset)
  let frames = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  reader.add(frames)
  require(reader.startReading(), "start decode")
  var count = 0
  while let sample = frames.copyNextSampleBuffer() {
    guard let pixel = CMSampleBufferGetImageBuffer(sample) else { require(false, "decoded image"); break }
    require(CVPixelBufferGetWidth(pixel) == 64 && CVPixelBufferGetHeight(pixel) == 64, "decoded dimensions")
    count += 1
  }
  require(reader.status == .completed && count == 2, "decode exactly two frames")
  print("PASS mp4")
}
