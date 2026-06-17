import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Key under which the pending quick-action is stored for the web layer.
    // MUST match the @capacitor/preferences key WITH its default group prefix
    // ("CapacitorStorage."), otherwise Preferences.get() on the web side never
    // sees it (the plugin reads UserDefaults key "CapacitorStorage.<key>").
    private static let pendingActionKey = "CapacitorStorage.ap_pending_native_action"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Cold launch from a home-screen quick action: iOS passes the shortcut in
        // launchOptions and does NOT call performActionFor. Store it so the web app
        // can consume it once the remote site has loaded.
        if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            storePendingAction(for: shortcutItem)
        }
        return true
    }

    private func storePendingAction(for shortcutItem: UIApplicationShortcutItem) {
        let action: String?
        switch shortcutItem.type {
        case "org.accessibleplaces.app.parking": action = "parking"
        case "org.accessibleplaces.app.toilet":  action = "toilet"
        default:                                  action = nil
        }
        if let action = action {
            UserDefaults.standard.set(action, forKey: AppDelegate.pendingActionKey)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Home screen quick actions (warm launch / app already running) — store the
    // pending action so the web app can pick it up via @capacitor/preferences on
    // the next appStateChange(isActive) event.
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        storePendingAction(for: shortcutItem)
        completionHandler(true)
    }

}
