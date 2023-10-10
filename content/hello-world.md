+++
title = "Hello, world"
date = 2023-10-09

[taxonomies]
categories = ["misc"]
tags = ["static site generator", "zola"]
+++

[中文](/zh/hello-world)

I used to have a self-hosted WordPress instance for writing my blogs. However, I recently made the decision to switch to a static site generator. Let me explain why.

<!-- more -->

WordPress is widely known as a great tool for blogging, but it also poses a significant security risk. Hackers often target WordPress servers, which prompted me to explore alternative options for hosting my blog. After careful consideration, I decided to use a public blogging platform called Zhihu. On Zhihu, I wrote several columns about the Rust language and the Fuchsia operating system.

Unfortunately, Zhihu is primarily a Chinese platform, limiting my audience reach to Chinese readers only. Additionally, due to the platform's focus on profitability, it has become inundated with rumors, cheap jokes, and fabricated stories. Consequently, it is not an ideal environment for engaging in serious technical discussions.

Hence, I have chosen to utilize a static site generator and host my blog on GitHub Pages. This decision allows me greater control over my content and ensures a more focused and reliable platform for sharing my ideas.

For those interested in the technology choices behind my blog site, here is a list:

1. [Zola](https://www.getzola.org/): A static site generator written in Rust. I chose it because it is written in Rust, and it is fast.
2. [Even](https://github.com/getzola/even.git): The theme used for this site.
3. GitHub Actions: for CI/CD
4. GitHub Pages: for hosting the site
