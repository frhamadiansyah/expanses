// swift-tools-version:5.3

import PackageDescription

// The Mac app's stand-in for https://github.com/ionic-team/capacitor-swift-pm: the same two products, built for Mac
// Catalyst from the same Capacitor version by ../build-capacitor-catalyst.sh (the official package has no Mac slice).
// The folder is named capacitor-swift-pm on purpose: that name is the package's identity, and it is what lets
// Mac.xcworkspace put this package in place of the remote one. Only the Mac workspace lists it; the iOS build never
// sees it. The two .xcframework folders are build output and are not in the repository.
let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    dependencies: [],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
