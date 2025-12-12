# Change Log

All notable changes to the "ren-py-python-docsup" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

* ### 0.0.41:
  
  > 很抱歉我上传错了版本，上个版本的定位逻辑是有问题的（我自己要用的时候才发现的）
  > I'm sorry I uploaded the wrong version. The positioning logic in the previous version was problematic (I only discovered it when I tried to use it myself).
* ### 0.0.4:
  
  > #### Changed:
  > 
  > > * 改变基本逻辑，使用镜像的方式完成
  > >   Change the basic logic and use the mirroring method to complete it
  > 
  > > * 注意！本次更新使用的方式会在工作目录下添加`.renpy-pyright`文件夹，并在其中创建基于rpy提取的py文件
  > >   Warning! This update will add a `.renpy-pyright`folder to your working directory and create `.py` files extracted from rpy files within it.
  
  > #### Removed:
  > 
  > > * 删除了对`#:`的支持
  > >   Removed support for `#:`
* ### 0.0.3:
  
  > #### Added:
  > 
  > > * 对变量添加了类型注释，使用 `#: [ 类型 ]`进行标注
  > >   Type annotations were added to variables, marked with `#: [ type ]`.
  > 
  > > * 增加对`$ `块的部分支持，必须在$后空一格
  > > * Added partial support for `$`blocks, a space must follow the \$ sign.
  > 
  > #### Fixed:
  > 
  > > * 部分修复了变量写在`python`块第一行时完全无法解析的问题
  > >   Partially fixed the issue where variables written on the first line of a `python`block could not be parsed at all.
* ### 0.0.2 :
  
  > #### Fixed：
  > 
  > > * 修复参数列表字符插入错误位置的问题。
  > >   Fixed the issue of incorrect character insertion position in the parameter list.

- 0.0.1 : Initial release

