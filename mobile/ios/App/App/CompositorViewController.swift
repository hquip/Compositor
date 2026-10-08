import Capacitor

class CompositorViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompositorImages())
    }
}
