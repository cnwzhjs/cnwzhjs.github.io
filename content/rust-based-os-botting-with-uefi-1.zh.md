+++
title = "用Rust写一个支持UEFI的操作系统 (1)"
date = 2023-10-15

[taxonomies]
categories = ["uefi-os"]
tags = ["uefi", "efi", "os", "rust"]
+++

### 该用UEFI写操作系统教程了

有很多操作系统教程和 YouTube 视频。然而，它们中的大多数都是为 BIOS 模式启动编写的。

然而，现在已经2023年了，离Intel开源UEFI的实现已经整整19年了。同时，Intel正在抛弃传统的`x86_64`架构，转向只支持64位的`x86_64s`. 当然，它只支持UEFI（UEFI CSM将被删除）。

UEFI是一个更安全、更强大的引导系统。几乎所有现代操作系统都是通过UEFI引导的。似乎没有理由继续为BIOS编写操作系统教程。我们不再需要关心如何切换到长模式，或者启用分页之类的烦人细节。

我在Google上搜索后发现，关于在UEFI中编写操作系统的信息非常有限。这些信息分散在不同的地方，很难找到完整的教程。因此，我决定写一系列关于在UEFI中编写操作系统的教程。

<!-- more -->

### 配置测试环境

大多数操作系统教程都使用QEMU作为测试环境，因为它有以下优点：

1. 只需要普通用户权限就可以执行（QEMU可以在模拟器模式下运行，这意味着它不需要访问任何硬件虚拟化基础架构，例如KVM）。
2. 它非常灵活，可以配置不同的硬件。
3. 它支持各种客户端CPU架构。此外，模拟器可以在与客户端CPU不同的主机CPU架构上运行。
4. 它支持模拟BIOS或UEFI作为固件接口。
5. 它支持调试器，可以轻松调试操作系统内核（通常在裸机上使用日志记录来调试内核）。

因此，在本教程中，我们也使用QEMU作为测试环境。好吧，我使用的是MacBook Pro，所以教程的命令行是针对macOS的，但是很容易转换为Linux版本。

1. 安装QEMU

我们通常使用[homebrew](https://brew.sh)来安装qemu：

```bash
brew install qemu
```

2. 为项目创建工作空间

```bash
mkdir tony-os && cd tony-os
git init .
mkdir -p src build buildenv {target,dist}/x86_64
```

3. 为QEMU准备UEFI固件

Intel的开源UEFI固件称为[TianoCore项目](http://www.tianocore.org)。代码也托管在[GitHub](https://github.com/tianocore).

在这个项目中，他们开发了一个支持QEMU的固件，提供了一个UEFI环境。

我们可以从[他们的持续集成服务器上](https://www.kraxel.org/repos/jenkins/edk2/)下载它，找到一个以"edk2.git-ovmf.x64"开头的文件，解压它，然后将`usr/share/edk2.git/ovmf-x64/OVMF-pure-efi.fd`复制到我们的工作空间的`target/x86_64/bios.bin`。

4. 准备脚本来测试我们的UEFI

在我们的工作空间中写入`run.sh`脚本：

```bash
#! /bin/bash

qemu-system-x86_64 \
    -L target/x86_64 \
    -bios target/x86_64/bios.bin \
    -hda fat:rw:dist/x86_64
```

然后，使其可执行：`chmod +x run.sh`。

如果你直接运行脚本的话，应该会启动并显示TianoCore的图像。

此事，你的工作空间应该是这样的：

```text
build
buildenv
dist
|- x86_64
src
target
|- x86_64
   |- bios.bin
run.sh
```

### 准备构建环境

Docker是一个用来固化你的构建环境的完美平台。因此，我们可以在`buildenv`文件夹下准备一个`Dockerfile`，来构建一个构建环境的镜像：

```dockerfile
FROM rust:1.73-bullseye

RUN rustup target add x86_64-unknown-uefi

VOLUME /root/env

WORKDIR /root/env
```

> Rust对UEFI目标有第二级支持，这意味着它不是官方支持的。但是，它对我们来说足够好了，可以写一个玩具操作系统。
>
> 感谢David Rheinsberg([@dvdhrm](https://github.com/dvdhrm)) 和 Nicholas Bishop([@nicholasbishop](https://github.com/nicholasbishop))维护了Rust的UEFI目标

构建镜像

```bash
docker build --platform linux/x86_64 buildenv -t tonyos-buildenv
```

### 准备一个最简单的内核

David Rheinsberg，UEFI目标的维护者，还维护了一个叫[r-efi](https://github.com/r-efi/r-efi)的crate，提供了UEFI的接口。我们可以使用这个crate来快速开始。

1. 创建在构建容器中运行的构建脚本：buildscript.sh

```bash
#! /bin/bash

# build the kernel
cargo build --target x86_64-unknown-uefi || exit 1

# copy the built kernel to the dist directory
mkdir -p dist/x86_64/EFI/BOOT || exit 1

cp target/x86_64-unknown-uefi/debug/tonyos.efi \
   dist/x86_64/EFI/BOOT/BOOTX64.EFI || exit 1
```

2. 创建调用容器的构建脚本：build.sh

```bash
#! /bin/bash

docker run -it \
    --platform linux/x86_64 \
    --rm \
    -v $(pwd):/root/env \
    tonyos-buildenv \
    ./buildscript.sh
```

3. 准备内核入口文件`src/main.rs`

```rust
#![no_main]
#![no_std]

extern crate r_efi;

use r_efi::efi;

#[panic_handler]
fn panic_handler(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

const HELLO_STR: &str = "Hello, world. Press any key to return to UEFI firmware.";

#[export_name = "efi_main"]
pub extern "C" fn main(_h: efi::Handle, st: *mut efi::SystemTable) -> efi::Status {
    let mut s = [0u16; HELLO_STR.len() + 1];
    let mut i = 0usize;
    for c in HELLO_STR.encode_utf16() {
        s[i] = c;
        i += 1;
        if i >= s.len() {
            break;
        }
    }

    // Print "Hello World!".
    let r =
        unsafe { ((*(*st).con_out).output_string)((*st).con_out, s.as_ptr() as *mut efi::Char16) };
    if r.is_error() {
        return r;
    }

    // Wait for key input, by waiting on the `wait_for_key` event hook.
    let r = unsafe {
        let mut x: usize = 0;
        ((*(*st).boot_services).wait_for_event)(1, &mut (*(*st).con_in).wait_for_key, &mut x)
    };
    if r.is_error() {
        return r;
    }

    efi::Status::SUCCESS
}
```

4. 准备`Cargo.toml`文件

```toml
[package]
name = "tonyos"
version = "0.1.0"
authors = ["Tony Huang <tony@tonyhuang.dev>"]
edition = "2021"

[build]
build-stage = 1
target = ["x86_64-unknown-uefi"]

[dependencies]
r-efi = "4"

# the profile used for `cargo build`
[profile.dev]
panic = "abort" # disable stack unwinding on panic

# the profile used for `cargo build --release`
[profile.release]
panic = "abort" # disable stack unwinding on panic
```

### 构建和运行你的第一个UEFI内核

现在，我们可以构建和运行我们的第一个UEFI内核了：

```bash
./build.sh && ./run.sh
```

![UEFI Hello World](/images/uefi-first-boot.png)
