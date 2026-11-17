#region conda initialize (fast, lazy)
# 用法：把 PowerShell 配置文件（$PROFILE 所在目录的 profile.ps1 或 Microsoft.PowerShell_profile.ps1）
# 里 "conda initialize" 那一段替换成下面这段，并把 $__cr 改成你的 Anaconda / Miniconda 安装目录。
#
# 原来的 conda init 每次启动 PowerShell 都要运行 conda.exe 生成 hook（约 3.5 秒）；
# 这里改成启动时直接设置 base 环境的变量（效果和激活 base 一样），
# 第一次真正敲 conda 命令时再加载完整 hook。想恢复原样运行：conda init powershell
$__cr = "C:\ProgramData\anaconda3"
If (Test-Path "$__cr\Scripts\conda.exe") {
    if (-not $env:CONDA_SHLVL) {
        $env:Path = "$__cr;$__cr\Library\mingw-w64\bin;$__cr\Library\usr\bin;$__cr\Library\bin;$__cr\Scripts;$__cr\bin;$__cr\condabin;$env:Path"
        $env:CONDA_PREFIX = $__cr
        $env:CONDA_DEFAULT_ENV = "base"
        $env:CONDA_SHLVL = "1"
        $env:CONDA_EXE = "$__cr\Scripts\conda.exe"
        $env:CONDA_PYTHON_EXE = "$__cr\python.exe"
        $env:CONDA_PROMPT_MODIFIER = "(base) "
    }
    $global:__CondaExe = "$__cr\Scripts\conda.exe"
    function global:conda {
        Remove-Item function:\conda -ErrorAction SilentlyContinue
        (& $global:__CondaExe "shell.powershell" "hook") | Out-String | ?{$_} | Invoke-Expression
        conda @args
    }
}
Remove-Variable __cr -ErrorAction SilentlyContinue
#endregion
