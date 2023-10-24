+++
title = "用Rust写一个支持UEFI的操作系统 (2)"
date = 2023-10-24

[taxonomies]
categories = ["uefi-os"]
tags = ["uefi", "efi", "os", "rust"]
+++

> 所有的代码都可以从我的[GitHub repo](https://github.com/cnwzhjs/blog-uefi-os)获得

### 什么是操作系统

在现代语境下，OS这个单词可能代表很多东西。

OS可以用来命名一个内核，例如Linux，Mach（macOS的内核）等。OS也可以用来命名一个内核和一组用户空间程序，例如GNU/Linux，macOS等。

在本系列文章中，我们主要关注OS内核的部分。那么OS的内核主要做什么呢？

OS内核的主要作用是提供硬件资源的虚拟化抽象，并为用户空间程序提供一组API来使用这些资源。

在这个定义中，OS内核应该：

1. 管理计算（CPU，GPU，应用程序特定加速器）和存储资源（内存，磁盘等），并将它们分配给用户空间程序。
2. 提供一个统一的接口来操作外设（键盘，鼠标，网络等）。

所以，在这篇文章中，我们会尝试通过UEFI接口检测设备的核心硬件资源：

1. CPU
2. 内存布局
3. 图形

<!-- more -->

### `cpuid` 指令

对于所有的x86 CPU，都有一个特殊的指令叫做`cpuid`。它用于查询CPU的特性。在rust中，我们可以使用`raw-cpuid` crate来访问这个指令。

```rust
fn print_cpu_info() {
    let cpuid = CpuId::new();
    let vendor_info = cpuid.get_vendor_info().unwrap();
    println!("Vendor: {}", vendor_info.as_str());
    let brand_info = cpuid.get_processor_brand_string().unwrap();
    println!("Processor: {}", brand_info.as_str());
    let feature_info = cpuid.get_feature_info().unwrap();
    let extended_processor_feature_info = cpuid.get_extended_processor_and_feature_identifiers().unwrap();
    let advanced_pm_info = cpuid.get_advanced_power_mgmt_info().unwrap();
    println!("Family: {:02X}h, Model: {:02X}h, Step: {:02X}h", feature_info.family_id(), feature_info.model_id(), feature_info.stepping_id());
    println!("Max logical processor ids: {}", feature_info.max_logical_processor_ids());
    println!("Features:");
    println!("    vmx: {}", feature_info.has_vmx());
    println!("    hypervisor: {}", feature_info.has_hypervisor());
    println!("    tsc: {}", feature_info.has_tsc());
    println!("    psn: {}", feature_info.has_psn());
    println!("    sysenter & sysexit: {}", feature_info.has_sysenter_sysexit());
    println!("    syscall & sysret: {}", extended_processor_feature_info.has_syscall_sysret());
    println!("    svm: {}", extended_processor_feature_info.has_svm());
    println!("    de: {}", extended_processor_feature_info.has_execute_disable());
    println!("    1g pages: {}", extended_processor_feature_info.has_1gib_pages());
    println!("    rdtscp: {}", extended_processor_feature_info.has_rdtscp());
    println!("    invariant tsc: {}", advanced_pm_info.has_invariant_tsc());
}
```

在上面的代码中，我们获取了CPU的基本信息。更重要的是检测CPU的特性。我们看到了很多缩写，让我们一一解释一下我们的OS所需的特性：

1. `tsc`: 时间戳计数器（我们需要检测CPU是否支持 `rdtsc` 指令)
2. `syscall` & `sysret`: 系统调用和系统返回指令。（如果你读过一些比较老的操作系统教程，他们会使用`int`指令来实现用户态和内核态的切换，在现代操作系统中，通常使用这两个指令来完成这个任务，它的overhead要更小一些）

对于上述检测的其他特性，我们会在以后的文章中解释，在本文中不再赘述。

### 检测内存布局

在BIOS的时代，内存布局是非常简单的，前1MB的内存是保留给BIOS的，剩下的内存是可用于OS的。

在UEFI的时代，由于固件提供了多得多的功能，所以内存布局也变得复杂了很多。

在UEFI中，内存布局是由一个叫做`EFI_MEMORY_DESCRIPTOR`的表来描述的。我们可以使用`uefi` crate中的`SystemTable<Boot>::get_memory_map()`来访问这个表：

```rust
fn print_memory_info(system_table: &mut SystemTable<Boot>) {
    // fetch the memory layout
    let mut buf = [0u8; 16_384];
    let buf_ptr = buf.as_ptr() as usize;

    let memory_map = system_table.boot_services().memory_map(&mut buf).unwrap();

    // print the memory layout
    println!("Memory map:");
    println!("{:16} {:16} {:12} {:8} {}", "Physical Addr", "Virtual Addr", "Num Pages", "Size", "Type");

    let mut i = 0;
    let mut total_pages = 0;
    let mut usable_pages = 0;

    for descriptor in memory_map.entries() {
        total_pages += descriptor.page_count;
        if descriptor.ty == MemoryType::CONVENTIONAL {
            usable_pages += descriptor.page_count;
        }

        if i != 0 && (i % 39) == 0 {
            println!("--- MORE ---");
            wait_for_any_key(system_table);
        }

        print!(
            "{:016X} {:016X} {:12} ",
            descriptor.phys_start,
            descriptor.virt_start,
            descriptor.page_count,
        );

        print_size_of_pages(descriptor.page_count as usize);

        println!(" {:?} ({:?})", descriptor.ty, descriptor.att);

        i += 1;
    }

    println!("--- END ---");
    print!("Total: ");
    print_size_of_pages(total_pages as usize);
    print!(", Usable: ");
    print_size_of_pages(usable_pages as usize);
    println!();
    println!();

    println!("buf (stack) is located at {:016X}, section:", buf_ptr);
    print_pointer_section(buf_ptr, &memory_map);

    let heap_buf = system_table.boot_services().allocate_pool(MemoryType::LOADER_DATA, 1024).unwrap();
    let heap_buf_ptr = heap_buf as usize;
    println!("heap_buf is located at {:016X}, section:", heap_buf_ptr);
    print_pointer_section(heap_buf_ptr, &memory_map);
    system_table.boot_services().free_pool(heap_buf).unwrap();    
}
```

在上面的代码中，我们首先获取了内存布局，然后打印了内存布局的信息。我们可以看到，内存布局被分成了很多段，我们真正关心的是`CONVENTIONAL`段，这个段是可用于OS的内存。

### 检测图形系统

通常，操作系统的教程主要关注于底层的实现。大多数的这些教程都运行在文本模式下。然而，我对此有着非常不同的喜好。

其原因可以追溯到1995年，我第一次接触到电脑的时候。那是一台运行MS-DOS 6.22的奔腾133MHz的电脑。当时我被QBASIC能够提供的图形体验所惊艳。这是我第一次感受到，我可以通过电脑来释放我的创造力。

BIOS通过`int 10h`提供了一个非常间的的图形操作接口。大多数的DOS游戏都是通过这个接口来提供沉浸式的游戏体验。

UEFI通过`protocol`这个概念，提供了一个非常灵活的服务接口。图形输出的接口被称为`EFI_GRAPHICS_OUTPUT_PROTOCOL`。下面是访问这个接口的代码：

```rust
fn print_display_info(image_handle: Handle, system_table: &mut SystemTable<Boot>) {
    let boot_services = system_table.boot_services();
    let gop_handle = boot_services.get_handle_for_protocol::<GraphicsOutput>().unwrap();

    let gop = unsafe { system_table
        .boot_services()
        .open_protocol::<GraphicsOutput>(OpenProtocolParams {
            handle: gop_handle,
            agent: image_handle,
            controller: None
        }, OpenProtocolAttributes::GetProtocol
    ) }.unwrap();

    println!("Supported Modes:");
    for mode in gop.modes() {
        println!(
            "    {:4} x {:4} @ {:?}",
            mode.info().resolution().0,
            mode.info().resolution().1,
            mode.info().pixel_format()
        );
    };

    let current_mode = gop.current_mode_info();
    println!("Current Mode:");
    println!(
        "    {:4} x {:4} @ {:?}",
        current_mode.resolution().0,
        current_mode.resolution().1,
        current_mode.pixel_format()
    );
}
```

在上述的代码中，需要特别解释的是2个API：

1. `get_handle_for_protocol`: 这个API获得了某种Protocol的Handle。在UEFI中，一个protocol是由一个GUID表示的。图形输出的GUID在`uefi`这个crate中已经被硬编码在了`uefi::proto::console::gop::GraphicsOutput`这个结构中。这个handle是我们活得具体的服务所必须的。

2. `open_protocol`: 这个API是我们获得由某个UEFI驱动提供的服务的接口。

通过顺序调用这两个API，我们可以获得图形设备的一些基本功能。

详细的文档可以在[`uefi`文档](https://docs.rs/uefi/0.25.0/uefi/proto/console/gop/struct.GraphicsOutput.html)中找到。

我们可以使用这些API来改变屏幕的分辨率（`set_mode(&mut self, mode: &Mode)`），访问帧缓冲区（`frame_buffer(&mut self)`），以及使用`blt`来执行屏幕清理和滚动。

### 接下来做什么

在下一篇文章中，我们会尝试切换图形模式，并将日志打印到屏幕上。

### 延伸阅读

上一篇文章: [Get started](/zh/rust-based-os-botting-with-uefi-1/)
