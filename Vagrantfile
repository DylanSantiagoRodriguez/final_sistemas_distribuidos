Vagrant.configure("2") do |config|
  config.vm.provider "virtualbox" do |vb|
    vb.memory = 1024
    vb.cpus = 1
  end

  boxes = {
    "vm-auth" => { ip: "10.10.0.10" },
    "vm-data" => { ip: "10.10.0.20" },
    "vm-ingest" => { ip: "10.10.0.30" },
    "vm-core" => { ip: "10.10.0.40" },
    "vm-app" => { ip: "10.10.0.50" }
  }

  boxes.each do |name, opts|
    config.vm.define name do |node|
      node.vm.box = "ubuntu/jammy64"
      node.vm.hostname = name
      node.vm.network "private_network", ip: opts[:ip]
      node.vm.synced_folder ".", "/vagrant", disabled: true
    end
  end

  config.vm.provision "ansible" do |ansible|
    ansible.playbook = "ansible/playbook.yml"
    ansible.inventory_path = "ansible/inventory.ini"
  end

end

