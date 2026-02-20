let activeRules = []
let activeWindows = []
let panelWindows = []
let monitors = [];
let applyLogicCache = []

updateActiveRules()
updateActiveMonitorsVisuallySorted()
update_ActiveWindows_and_Panels()

options.configChanged.connect(() => {
    console.info("config changed. updating")
    updateTimerInterval()
    updateActiveRules()
})
workspace.screensChanged.connect(updateActiveMonitorsVisuallySorted)
workspace.windowAdded.connect(() => {
    console.info("window was added")
    update_ActiveWindows_and_Panels()
})
workspace.windowRemoved.connect(() => {
    console.info("window was removed")
    update_ActiveWindows_and_Panels()
})

let logicTimer = new QTimer()
logicTimer.interval = readConfig("TimerInterval", 100)
logicTimer.singleShot = false
logicTimer.timeout.connect(calculateLogic)
logicTimer.start()


function updateTimerInterval(){
    console.info("updating timer interval to" + readConfig("TimerInterval", 999))
    let interval = readConfig("TimerInterval", 100)

    if(logicTimer){
    logicTimer.stop()
    logicTimer.interval = interval
    logicTimer.start()
    }
}


function updateActiveRules(){
    console.info("updating active rules")
    let RawRules = readConfig("CustomLogic", "")
    if (!RawRules) {return}

    let RuleList = RawRules.split('\n')

    activeRules = []
    for (let i = 0; i < RuleList.length; i++){
        let ruleSet = RuleList[i].toLowerCase()
        let rules = ruleSet.split(" ")
        console.info(rules)
        if (rules.length != 13) continue

            activeRules.push({
                function: rules[0].trim(),
                            newMode: rules[0].trim(),
                            targetPanelPosition: rules[1].trim(),
                            targetPanelScreenId: parseInt(rules[5].trim()),
                            triggerPanelPosition: rules[7].trim(),
                            triggerPanelScreenId:  parseInt(rules[11].trim()),
                            triggerPanelVisibilityState: rules[12].trim()
            })
    }
}


function update_ActiveWindows_and_Panels(){
    console.info("updating active windows and panles")
    let windows = workspace.windowList()
    panelWindows = []
    activeWindows = []

    for (let i = 0; i < windows.length; i++){
        let window = windows[i]

        if (window.caption == "" && window.resourceClass === "plasmashell" && window.dock){
            panelWindows.push(window)
        }
        else if (window.windowType == 0 && window.resourceClass != "" && window.caption != ""){
            activeWindows.push(window)
        }
    }
}


function updateActiveMonitorsVisuallySorted() {
    console.info("updating active monitors")
    let temp_monitors = Array.prototype.slice.call(workspace.screens);
    temp_monitors.sort(function(a, b) {
        if (Math.abs(a.geometry.x - b.geometry.x) < 5) {
            return a.geometry.y - b.geometry.y;
        }
        return a.geometry.x - b.geometry.x;
    });
    monitors = temp_monitors;
}


function calculateLogic(){
    let applyLogic = []
    activeRules.forEach(rule => {
        let triggerPanel = findPanel(rule.triggerPanelPosition, rule.triggerPanelScreenId)
        if (!triggerPanel) return
        let isAnyActiveWindowFullscreen = isAnyWindowFullscreenOnScreen(rule.triggerPanelScreenId)
        let isAnyWindowCollidingWithTriggerPanel = isAnyWindowCollidingWithPanel(triggerPanel)

        let predictedTriggerState = {}

        predictedTriggerState.autohide = (rule.triggerPanelVisibilityState == "hidden")

        let tempTriggerVisibility = (!isAnyWindowCollidingWithTriggerPanel)
        predictedTriggerState.dodgewindows = rule.triggerPanelVisibilityState == "visible" ? tempTriggerVisibility : (!tempTriggerVisibility)

        tempTriggerVisibility = (!isAnyActiveWindowFullscreen)
        predictedTriggerState.none = rule.triggerPanelVisibilityState == "visible"  ? tempTriggerVisibility : (!tempTriggerVisibility)

        applyLogic.push({targetPanelPos: rule.targetPanelPosition, targetScreenId: rule.targetPanelScreenId, triggerPanelPos: rule.triggerPanelPosition, triggerScreenId: rule.triggerPanelScreenId, newMode: rule.newMode, predictedTriggerState: predictedTriggerState})
    });

    if (JSON.stringify(applyLogic) !== JSON.stringify(applyLogicCache)){
        console.info("------------------------------------------logic changed. runing dbus-----------------------------------")
        applyLogicCache = applyLogic
        applyLogicPlasmaSide(applyLogic)
    }
}

//this is working i think. now to add cathing and to only call dbuss when a change occurse.
function applyLogicPlasmaSide(applyLogic){
    let code = `
    var applyCache = ${JSON.stringify(applyLogic)}
    var panels = panels()

    for (var j = 0; j < applyCache.length; j++){
        var logicVariable = applyCache[j]

        var autohidePrediction = logicVariable.predictedTriggerState.autohide
        var dodgewindowsPrediction = logicVariable.predictedTriggerState.dodgewindows
        var nonePrediction = logicVariable.predictedTriggerState.none

        var triggerPanel
        var targetPanel

        var trigerPanelScreenId = getPlasmaIdFromVisualIndex(logicVariable.triggerScreenId)
        var targetPanelScreenId = getPlasmaIdFromVisualIndex(logicVariable.targetScreenId)

        for (var i = 0; i < panels.length; i++){
            var panel = panels[i]
            if (panel.location == logicVariable.targetPanelPos && panel.screen == targetPanelScreenId){
                targetPanel = panel
            }
            else if (panel.location == logicVariable.triggerPanelPos && panel.screen == trigerPanelScreenId){
                triggerPanel = panel
            }
        }
        if (triggerPanel && targetPanel) {
            switch (triggerPanel.hiding){
                case "autohide":
                    if (autohidePrediction == true){
                        targetPanel.hiding = logicVariable.newMode
                    }
                    break
                case "dodgewindows":
                    if (dodgewindowsPrediction == true){
                        targetPanel.hiding = logicVariable.newMode
                    }
                    break
                case "none":
                    if (nonePrediction == true){
                        targetPanel.hiding = logicVariable.newMode
                    }
                    break
            }
        }
    }

    function getPlasmaIdFromVisualIndex(visualIndex) {
        var screens = [];
        for (var i = 0; i < screenCount; i++) {
            var rect = screenGeometry(i);
            if (rect.width > 0) { // Valid screen
                screens.push({ id: i, x: rect.x, y: rect.y });
            }
        }
        screens.sort(function(a, b) {
            if (a.x === b.x) {
                return a.y - b.y;
            }
            return a.x - b.x;
        });
        if (visualIndex < screens.length) {
            return screens[visualIndex].id;
        }
        return 0;
    }
    `;
    callPlasmaShellWithCode(code)
}


function findPanel(position, monitorId){
    let monitor = monitors[monitorId]
    for (let i = 0; i < panelWindows.length; i++){
        let panel = panelWindows[i]
        switch (position){
            case "top":
                if (panel.frameGeometry.y == monitor.geometry.y && panel.output === monitor){
                    if (!(panel.frameGeometry.height >= monitor.geometry.height)){return panel}
                }
                break
            case "bottom":
                if ((panel.frameGeometry.y + panel.frameGeometry.height) == (monitor.geometry.y + monitor.geometry.height) && panel.output === monitor){
                    if (!(panel.frameGeometry.height >= monitor.geometry.height)){return panel}
                }
                break
            case "left":
                if (panel.frameGeometry.x == monitor.geometry.x && panel.output === monitor){
                    if (!(panel.frameGeometry.width >= monitor.geometry.width)){return panel}
                }
                break
            case "right":
                if ((panel.frameGeometry.x + panel.frameGeometry.width) == (monitor.geometry.x + monitor.geometry.width) && panel.output === monitor){
                    if (!(panel.frameGeometry.width >= monitor.geometry.width)){return panel}
                }
                break
        }
    }
    return null
}


function isAnyWindowCollidingWithPanel(panel){
    let p = panel.frameGeometry

    for (let window of activeWindows) {
        if (window.minimized) continue
        let w = window.frameGeometry
        if (!(
            (p.y + p.height) <= w.y ||
            p.y >= (w.y + w.height) ||
            (p.x + p.width) <= w.x ||
            p.x >= (w.x + w.width)
        )){
            return true
        }
    }
    return false
}


function isAnyWindowFullscreenOnScreen(monitorId){
    let screen = monitors[monitorId]

    for (window of activeWindows){
        if (window.minimized) continue
        if (window.fullScreen && window.output === screen){return true}
    }

    return false
}


function callPlasmaShellWithCode(code){
    console.info("calling Dbus")
    callDBus(
        "org.kde.plasmashell",
        "/PlasmaShell",
        "org.kde.PlasmaShell",
        "evaluateScript",
        code
    )
}
