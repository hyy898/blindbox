-- 只关闭已经结束的、独占一个窗口的游戏终端；不关闭仍在运行的 shell 或其他标签页。
on run args
    if (count of args) is not 1 then return
    set gameTTY to item 1 of args
    repeat 10 times
        delay 0.5
        tell application "Terminal"
            repeat with gameWindow in (get every «class cwin»)
                if (count of «class ttab» of gameWindow) is 1 then
                    set gameTab to «class ttab» 1 of gameWindow
                    if («class ttty» of gameTab) is gameTTY then
                        if («class busy» of gameTab) is false and (count of «class prcs» of gameTab) is 0 then
                            «event coreclos» gameWindow
                            return
                        end if
                    end if
                end if
            end repeat
        end tell
    end repeat
end run
