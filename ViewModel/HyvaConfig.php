<?php
declare(strict_types=1);

namespace PixelOpen\CloudflareTurnstile\ViewModel;

use Magento\Framework\Serialize\Serializer\Json;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Framework\UrlInterface;
use PixelOpen\CloudflareTurnstile\Model\ConfigProvider\Frontend;

/** Public, store-scoped configuration only; safe for full-page caching. */
class HyvaConfig implements ArgumentInterface
{
    private Frontend $provider;
    private Json $json;
    private UrlInterface $url;

    public function __construct(Frontend $provider, Json $json, UrlInterface $url)
    {
        $this->provider = $provider;
        $this->json = $json;
        $this->url = $url;
    }

    public function getJson(): string
    {
        $config = $this->provider->getConfig()['config'];
        $config['loginUrl'] = $this->url->getUrl('customer/ajax/login', ['_secure' => true]);
        $config['checkoutUrl'] = $this->url->getUrl('checkout', ['_secure' => true]);
        $config['messages'] = [
            'pending' => (string) __('Please complete the security verification.'),
            'error' => (string) __('Unable to secure the form. Please reload the page and try again.'),
            'missing' => (string) __('Unable to secure the form. The site key is missing.'),
        ];
        return $this->json->serialize($config);
    }
}
